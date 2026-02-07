import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import {
  splitGeometryIntoSegments,
  buildStraightLineSegments,
  getSegmentLabel,
} from '../../utils/routeGeometry';
import styles from './RouteMapPanel.module.css';

export interface MapStop {
  id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number };
  eta?: string;
  etd?: string;
  order?: number;
}

export interface MapDepot {
  lat: number;
  lng: number;
  name?: string;
}

export interface InsertionPreview {
  candidateId: string;
  candidateName: string;
  coordinates: { lat: number; lng: number };
  insertAfterIndex: number;
  insertBeforeIndex: number;
}

interface RouteMapPanelProps {
  stops: MapStop[];
  depot: MapDepot | null;
  routeGeometry?: [number, number][];
  highlightedStopId?: string | null;
  insertionPreview?: InsertionPreview | null;
  onStopClick?: (stopId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Called when a route segment is highlighted/unhighlighted */
  onSegmentHighlight?: (segmentIndex: number | null) => void;
  /** Currently highlighted segment (controlled mode) */
  highlightedSegment?: number | null;
}

export function RouteMapPanel({
  stops,
  depot,
  routeGeometry,
  highlightedStopId,
  insertionPreview,
  onStopClick,
  isLoading,
  className,
  onSegmentHighlight,
  highlightedSegment: controlledHighlightedSegment,
}: RouteMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Event handler refs for proper cleanup
  const segmentClickHandlerRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const segmentEnterHandlerRef = useRef<(() => void) | null>(null);
  const segmentLeaveHandlerRef = useRef<(() => void) | null>(null);

  // Internal segment highlight state (used when not controlled)
  const [internalHighlightedSegment, setInternalHighlightedSegment] = useState<number | null>(null);

  // Use controlled or internal state
  const highlightedSegment = controlledHighlightedSegment !== undefined
    ? controlledHighlightedSegment
    : internalHighlightedSegment;

  const setHighlightedSegment = useCallback((value: number | null) => {
    if (onSegmentHighlight) {
      onSegmentHighlight(value);
    } else {
      setInternalHighlightedSegment(value);
    }
  }, [onSegmentHighlight]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter = depot
      ? [depot.lng, depot.lat] as [number, number]
      : [14.4378, 50.0755] as [number, number]; // Prague default

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: initialCenter,
      zoom: 11,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [depot]);

  // Update depot marker
  useEffect(() => {
    if (!mapRef.current || !depot) return;

    if (depotMarkerRef.current) {
      depotMarkerRef.current.setLngLat([depot.lng, depot.lat]);
    } else {
      depotMarkerRef.current = new maplibregl.Marker({ color: '#22c55e' })
        .setLngLat([depot.lng, depot.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<strong>Depo</strong><br/>${depot.name || 'Výchozí místo'}`))
        .addTo(mapRef.current);
    }
  }, [depot]);

  // Clear all stop markers and route layers
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
  }, []);

  const clearRouteLayers = useCallback(() => {
    if (!mapRef.current) return;

    // Remove event handlers
    if (segmentClickHandlerRef.current) {
      mapRef.current.off('click', 'route-hit-area', segmentClickHandlerRef.current);
      segmentClickHandlerRef.current = null;
    }
    if (segmentEnterHandlerRef.current) {
      mapRef.current.off('mouseenter', 'route-hit-area', segmentEnterHandlerRef.current);
      segmentEnterHandlerRef.current = null;
    }
    if (segmentLeaveHandlerRef.current) {
      mapRef.current.off('mouseleave', 'route-hit-area', segmentLeaveHandlerRef.current);
      segmentLeaveHandlerRef.current = null;
    }

    // Remove layers and sources
    for (const layerId of ['route-highlight', 'route-hit-area', 'route-line']) {
      if (mapRef.current.getLayer(layerId)) {
        mapRef.current.removeLayer(layerId);
      }
    }
    if (mapRef.current.getSource('route-segments')) {
      mapRef.current.removeSource('route-segments');
    }
    // Legacy single-line source
    if (mapRef.current.getSource('route')) {
      mapRef.current.removeSource('route');
    }

    setHighlightedSegment(null);
  }, [setHighlightedSegment]);

  // Update stop markers
  useEffect(() => {
    if (!mapRef.current) return;

    clearMarkers();

    stops.forEach((stop, index) => {
      const isHighlighted = stop.id === highlightedStopId;
      const marker = new maplibregl.Marker({
        color: isHighlighted ? '#f59e0b' : '#3b82f6',
      })
        .setLngLat([stop.coordinates.lng, stop.coordinates.lat])
        .setPopup(
          new maplibregl.Popup().setHTML(`
            <strong>${index + 1}. ${stop.name}</strong><br/>
            ${stop.address}<br/>
            ${stop.eta && stop.etd ? `<small>ETA: ${stop.eta} | ETD: ${stop.etd}</small>` : ''}
          `)
        )
        .addTo(mapRef.current!);

      // Add number label
      const el = marker.getElement();
      const label = document.createElement('div');
      label.className = styles.markerLabel;
      label.textContent = String(index + 1);
      el.appendChild(label);

      // Click handler
      if (onStopClick) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => onStopClick(stop.id));
      }

      markersRef.current.set(stop.id, marker);
    });
  }, [stops, highlightedStopId, onStopClick, clearMarkers]);

  // Update route line as segmented GeoJSON with highlight support
  useEffect(() => {
    if (!mapRef.current) return;

    clearRouteLayers();

    if (stops.length === 0 || !depot) return;

    // Build segments using shared utilities
    const waypoints = stops.map((s) => ({
      coordinates: s.coordinates,
      name: s.name,
    }));

    let segments: [number, number][][];
    if (routeGeometry && routeGeometry.length > 0) {
      segments = splitGeometryIntoSegments(routeGeometry, waypoints, depot);
    } else {
      segments = buildStraightLineSegments(waypoints, depot);
    }

    if (segments.length === 0) return;

    // Build GeoJSON FeatureCollection with segmentIndex property
    const features = segments.map((coords, index) => ({
      type: 'Feature' as const,
      properties: { segmentIndex: index },
      geometry: {
        type: 'LineString' as const,
        coordinates: coords,
      },
    }));

    mapRef.current.addSource('route-segments', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    });

    // Base route line (all segments)
    mapRef.current.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#3b82f6',
        'line-width': 4,
        'line-opacity': 0.8,
      },
    });

    // Wider invisible hit area for clicking segments
    mapRef.current.addLayer({
      id: 'route-hit-area',
      type: 'line',
      source: 'route-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': 'transparent',
        'line-width': 20,
        'line-opacity': 0,
      },
    });

    // Highlight layer (only shows the selected segment)
    mapRef.current.addLayer({
      id: 'route-highlight',
      type: 'line',
      source: 'route-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#f59e0b',
        'line-width': 6,
        'line-opacity': 0.9,
      },
      filter: ['==', ['get', 'segmentIndex'], -1], // Hide initially
    });

    // Click handler: toggle segment highlight
    segmentClickHandlerRef.current = (e) => {
      const feat = e.features;
      if (feat && feat.length > 0) {
        const clickedIndex = feat[0].properties?.segmentIndex;
        if (typeof clickedIndex === 'number') {
          const newValue = highlightedSegment === clickedIndex ? null : clickedIndex;
          setHighlightedSegment(newValue);
        }
      }
    };
    mapRef.current.on('click', 'route-hit-area', segmentClickHandlerRef.current);

    // Cursor pointer on hover
    segmentEnterHandlerRef.current = () => {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'pointer';
    };
    segmentLeaveHandlerRef.current = () => {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
    };
    mapRef.current.on('mouseenter', 'route-hit-area', segmentEnterHandlerRef.current);
    mapRef.current.on('mouseleave', 'route-hit-area', segmentLeaveHandlerRef.current);

    // Fit bounds
    const allCoords = segments.flat();
    const bounds = new maplibregl.LngLatBounds();
    allCoords.forEach((coord) => bounds.extend(coord));
    mapRef.current.fitBounds(bounds, { padding: 50 });
  }, [stops, depot, routeGeometry, clearRouteLayers]);

  // Update highlight filter when highlightedSegment changes
  useEffect(() => {
    if (!mapRef.current) return;
    if (!mapRef.current.getLayer('route-highlight')) return;

    if (highlightedSegment !== null) {
      mapRef.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], highlightedSegment]);
    } else {
      mapRef.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], -1]);
    }
  }, [highlightedSegment]);

  // Update insertion preview marker
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove existing preview marker
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
      previewMarkerRef.current = null;
    }

    // Remove existing preview line
    if (mapRef.current.getLayer('preview-line')) {
      mapRef.current.removeLayer('preview-line');
    }
    if (mapRef.current.getSource('preview')) {
      mapRef.current.removeSource('preview');
    }

    if (!insertionPreview || !depot) return;

    // Add preview marker (pulsing)
    const el = document.createElement('div');
    el.className = styles.previewMarker;

    previewMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([insertionPreview.coordinates.lng, insertionPreview.coordinates.lat])
      .setPopup(
        new maplibregl.Popup().setHTML(`
          <strong>Návrh: ${insertionPreview.candidateName}</strong><br/>
          <small>Vloží se mezi ${insertionPreview.insertAfterIndex + 1} → ${insertionPreview.insertBeforeIndex + 1}</small>
        `)
      )
      .addTo(mapRef.current);

    // Draw preview insertion line
    const prevStop = stops[insertionPreview.insertAfterIndex];
    const nextStop = stops[insertionPreview.insertBeforeIndex];

    if (prevStop && nextStop) {
      const previewCoords: [number, number][] = [
        [prevStop.coordinates.lng, prevStop.coordinates.lat],
        [insertionPreview.coordinates.lng, insertionPreview.coordinates.lat],
        [nextStop.coordinates.lng, nextStop.coordinates.lat],
      ];

      mapRef.current.addSource('preview', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: previewCoords,
          },
        },
      });

      mapRef.current.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 3,
          'line-dasharray': [2, 2],
          'line-opacity': 0.9,
        },
      });
    }
  }, [insertionPreview, stops, depot]);

  // Build segment info overlay
  const segmentInfo = highlightedSegment !== null && stops.length > 0
    ? getSegmentLabel(
        highlightedSegment,
        stops.map((s) => ({ name: s.name })),
        depot?.name || 'Depo',
      )
    : null;

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
      <div ref={containerRef} className={styles.map} />
      {stops.length === 0 && !isLoading && (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>🗺️</span>
          <p>Zatím žádné zastávky v trase</p>
        </div>
      )}
      {segmentInfo && (
        <div className={styles.segmentInfo}>
          <span className={styles.segmentInfoLabel}>
            {segmentInfo.fromName} → {segmentInfo.toName}
          </span>
          <button
            className={styles.segmentInfoClose}
            onClick={() => setHighlightedSegment(null)}
            title="Zrušit zvýraznění"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
