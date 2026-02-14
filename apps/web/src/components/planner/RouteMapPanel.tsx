import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import {
  splitGeometryIntoSegments,
  buildStraightLineSegments,
  getSegmentLabel,
} from '../../utils/routeGeometry';
import { logger } from '../../utils/logger';
import type { SavedRouteStop } from '../../services/routeService';
import styles from './RouteMapPanel.module.css';

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

export interface SelectedCandidate {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
}

interface RouteMapPanelProps {
  stops: SavedRouteStop[];
  depot: MapDepot | null;
  routeGeometry?: [number, number][];
  highlightedStopId?: string | null;
  /** Show a candidate's location on the map before it is added to the route */
  selectedCandidate?: SelectedCandidate | null;
  insertionPreview?: InsertionPreview | null;
  onStopClick?: (stopId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Called when a route segment is highlighted/unhighlighted */
  onSegmentHighlight?: (segmentIndex: number | null) => void;
  /** Currently highlighted segment (controlled mode) */
  highlightedSegment?: number | null;
  /** Debug source tag (planner / inbox / day overview) */
  debugSource?: string;
  /** Debug route id */
  debugRouteId?: string | null;
}

export function RouteMapPanel({
  stops,
  depot,
  routeGeometry,
  highlightedStopId,
  selectedCandidate,
  insertionPreview,
  onStopClick,
  isLoading,
  className,
  onSegmentHighlight,
  highlightedSegment: controlledHighlightedSegment,
  debugSource: _debugSource,
  debugRouteId: _debugRouteId,
}: RouteMapPanelProps) {
  const { t } = useTranslation('planner');
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const selectedCandidateMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Event handler refs for proper cleanup
  const segmentClickHandlerRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const segmentEnterHandlerRef = useRef<(() => void) | null>(null);
  const segmentLeaveHandlerRef = useRef<(() => void) | null>(null);
  const highlightedSegmentRef = useRef<number | null>(null);

  // Track whether map style has finished loading (needed before addSource/addLayer)
  const [mapLoaded, setMapLoaded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(11);

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

  useEffect(() => {
    highlightedSegmentRef.current = highlightedSegment ?? null;
  }, [highlightedSegment]);

  // Initialize map (only once - depot changes are handled by fitBounds/flyTo)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = [14.4378, 50.0755]; // Prague default

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

    mapRef.current.on('load', () => {
      setMapLoaded(true);
    });

    mapRef.current.on('zoom', () => {
      setZoomLevel(mapRef.current?.getZoom() ?? 0);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  // Map instance must be created exactly once per mount; recreating on prop changes leaks handlers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update depot marker
  useEffect(() => {
    if (!mapRef.current || !depot) return;

    if (depotMarkerRef.current) {
      depotMarkerRef.current.setLngLat([depot.lng, depot.lat]);
    } else {
      depotMarkerRef.current = new maplibregl.Marker({ color: '#22c55e' })
        .setLngLat([depot.lng, depot.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<strong>${t('map_depot_popup')}</strong><br/>${depot.name || t('map_depot_default')}`))
        .addTo(mapRef.current);
    }
  }, [depot, t]);

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

  }, []);

  // Update stop markers
  useEffect(() => {
    if (!mapRef.current) return;

    clearMarkers();

    const snappedCoordByStopId = new Map<string, [number, number]>();
    if (routeGeometry && routeGeometry.length > 0 && depot) {
      const mappableStops = stops.filter((s) => s.customerLat != null && s.customerLng != null);
      if (mappableStops.length > 0) {
        const waypoints = mappableStops.map((s) => ({
          coordinates: { lat: s.customerLat!, lng: s.customerLng! },
          name: s.customerName ?? undefined,
        }));
        const snappedSegments = splitGeometryIntoSegments(routeGeometry, waypoints, depot);
        for (let i = 0; i < mappableStops.length; i += 1) {
          const seg = snappedSegments[i];
          const end = seg?.[seg.length - 1];
          if (end) {
            snappedCoordByStopId.set(mappableStops[i].id, end);
          }
        }
      }
    }

    stops.forEach((stop, index) => {
      const markerKey = stop.customerId ?? stop.id;
      const isHighlighted = stop.id === highlightedStopId || stop.customerId === highlightedStopId;
      const snapped = snappedCoordByStopId.get(stop.id);
      const lat = snapped ? snapped[1] : stop.customerLat;
      const lng = snapped ? snapped[0] : stop.customerLng;
      if (!lat || !lng) return; // Skip stops without coordinates

      const el = document.createElement('div');
      el.className = `${styles.stopMarker} ${isHighlighted ? styles.stopMarkerHighlighted : ''}`;
      const label = document.createElement('span');
      label.className = styles.markerLabel;
      label.textContent = String(index + 1);
      el.appendChild(label);

      // Use 'top-left' anchor with explicit pixel offset instead of 'bottom'.
      // 'bottom' uses CSS translate(-50%,-100%) which depends on the element's
      // computed height. If CSS module hasn't loaded yet, the height may be wrong
      // (e.g. 12px from label content instead of 36px from CSS), causing the
      // marker to drift hundreds of km south at low zoom levels.
      // With 'top-left' + fixed offset, positioning is independent of CSS timing.
      // Marker is 30×36px; bottom-center tip is at (15, 36) from top-left.
      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'top-left',
        offset: [-15, -36],
      })
        .setLngLat([lng, lat])
        .setPopup(
          new maplibregl.Popup().setHTML(`
            <strong>${index + 1}. ${stop.customerName}</strong><br/>
            ${stop.address}<br/>
            ${stop.estimatedArrival && stop.estimatedDeparture ? `<small>ETA: ${stop.estimatedArrival} | ETD: ${stop.estimatedDeparture}</small>` : ''}
          `)
        )
        .addTo(mapRef.current!);

      // Click handler
      if (onStopClick) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => onStopClick(markerKey));
      }

      markersRef.current.set(markerKey, marker);
    });
  }, [stops, highlightedStopId, onStopClick, clearMarkers, routeGeometry, depot]);

  // Show selected candidate location on the map (before adding to route)
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove previous selected candidate marker
    if (selectedCandidateMarkerRef.current) {
      selectedCandidateMarkerRef.current.remove();
      selectedCandidateMarkerRef.current = null;
    }

    if (!selectedCandidate) return;

    // Don't show if candidate is already a route stop (it already has a numbered marker)
    if (stops.some((s) => s.customerId === selectedCandidate.id)) return;

    const { lat, lng } = selectedCandidate.coordinates;
    if (!lat || !lng) return;

    // Create a distinctive marker for the selected candidate
    const el = document.createElement('div');
    el.className = styles.selectedCandidateMarker;

    // Use 'top-left' with fixed pixel offset to avoid CSS-timing dependency.
    // Circle marker is 28×28px; center is at (14, 14).
    selectedCandidateMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-14, -14] })
      .setLngLat([lng, lat])
      .setPopup(
        new maplibregl.Popup({ offset: 25 }).setHTML(
          `<strong>${selectedCandidate.name}</strong>`
        )
      )
      .addTo(mapRef.current);
  }, [selectedCandidate, stops]);

  // Fit map bounds whenever relevant points change:
  // - No candidate, no route: center on depot
  // - Candidate selected, no route: fit depot + candidate
  // - Route exists (± candidate): fit all route stops + depot + candidate
  useEffect(() => {
    if (!mapRef.current) return;

    const candidateCoord = selectedCandidate
      && !stops.some((s) => s.id === selectedCandidate.id)
      && selectedCandidate.coordinates.lat && selectedCandidate.coordinates.lng
      ? selectedCandidate.coordinates
      : null;

    if (stops.length === 0 && !candidateCoord) {
      // No route, no candidate → center on depot
      if (depot) {
        mapRef.current.flyTo({
          center: [depot.lng, depot.lat],
          zoom: 11,
          duration: 500,
        });
      }
      return;
    }

    // Build bounds from all visible points
    const bounds = new maplibregl.LngLatBounds();

    // Include depot
    if (depot) {
      bounds.extend([depot.lng, depot.lat]);
    }

    // Include all route stops
    for (const stop of stops) {
      if (stop.customerLat && stop.customerLng) {
        bounds.extend([stop.customerLng, stop.customerLat]);
      }
    }

    // Include selected candidate
    if (candidateCoord) {
      bounds.extend([candidateCoord.lng, candidateCoord.lat]);
    }

    mapRef.current.fitBounds(bounds, { padding: 60, duration: 500, maxZoom: 14 });
  }, [selectedCandidate, stops, depot]);

  // Update route line as segmented GeoJSON with highlight support
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    clearRouteLayers();

    if (stops.length === 0) return;

    logger.info('[RouteMapPanel] Rendering route with', stops.length, 'stops, routeGeometry length:', routeGeometry?.length || 0, 'depot:', !!depot);

    // Build segments using shared utilities
    const waypoints = stops
      .filter((s) => s.customerLat && s.customerLng)
      .map((s) => ({
        coordinates: { lat: s.customerLat!, lng: s.customerLng! },
        name: s.customerName ?? undefined,
      }));

    // Use a fake depot at the first stop's location if no depot is set
    const effectiveDepot = depot ?? { lat: stops[0].customerLat!, lng: stops[0].customerLng! };

    let segments: [number, number][][];
    if (routeGeometry && routeGeometry.length > 0) {
      logger.info('[RouteMapPanel] Using Valhalla geometry');
      segments = splitGeometryIntoSegments(routeGeometry, waypoints, effectiveDepot);
    } else {
      logger.info('[RouteMapPanel] Using straight line segments (no Valhalla geometry)');
      segments = buildStraightLineSegments(waypoints, depot ? effectiveDepot : null);
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
        if (typeof clickedIndex === 'number' && Number.isFinite(clickedIndex)) {
          setHighlightedSegment(highlightedSegmentRef.current === clickedIndex ? null : clickedIndex);
        } else if (typeof clickedIndex === 'string') {
          const parsed = Number(clickedIndex);
          if (Number.isFinite(parsed)) {
            setHighlightedSegment(highlightedSegmentRef.current === parsed ? null : parsed);
          }
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
  }, [stops, depot, routeGeometry, clearRouteLayers, mapLoaded, setHighlightedSegment]);

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
    if (!mapRef.current || !mapLoaded) return;

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

    // Preview marker is 24×24px circle; center at (12, 12).
    const previewLabel = t('map_preview_label', { name: insertionPreview.candidateName });
    const previewInsert = t('map_preview_insert', {
      from: insertionPreview.insertAfterIndex + 1,
      to: insertionPreview.insertBeforeIndex + 1,
    });
    previewMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-12, -12] })
      .setLngLat([insertionPreview.coordinates.lng, insertionPreview.coordinates.lat])
      .setPopup(
        new maplibregl.Popup().setHTML(
          `<strong>${previewLabel}</strong><br/><small>${previewInsert}</small>`
        )
      )
      .addTo(mapRef.current);

    // Draw preview insertion lines (dashed)
    // insertAfterIndex can be -1 (insert at start, after depot) or a valid stop index.
    // insertBeforeIndex can be stops.length (insert at end, before depot return).
    // In both edge cases, use the depot coordinates as the fallback endpoint.
    const depotCoord: [number, number] = [depot.lng, depot.lat];
    const candidateCoord: [number, number] = [insertionPreview.coordinates.lng, insertionPreview.coordinates.lat];

    const prevPoint: [number, number] | null =
      insertionPreview.insertAfterIndex >= 0 && insertionPreview.insertAfterIndex < stops.length
        ? (() => {
            const s = stops[insertionPreview.insertAfterIndex];
            return s.customerLng && s.customerLat ? [s.customerLng, s.customerLat] : null;
          })()
        : depotCoord; // -1 means "after depot"

    const nextPoint: [number, number] | null =
      insertionPreview.insertBeforeIndex >= 0 && insertionPreview.insertBeforeIndex < stops.length
        ? (() => {
            const s = stops[insertionPreview.insertBeforeIndex];
            return s.customerLng && s.customerLat ? [s.customerLng, s.customerLat] : null;
          })()
        : depotCoord; // >= stops.length means "before depot return"

    // Build line segments: prevPoint → candidate and candidate → nextPoint
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    if (prevPoint) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [prevPoint, candidateCoord] },
      });
    }
    if (nextPoint) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [candidateCoord, nextPoint] },
      });
    }

    if (features.length > 0) {
      mapRef.current.addSource('preview', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
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
  }, [insertionPreview, stops, depot, mapLoaded, t]);

  // Build segment info overlay
  const segmentInfo = highlightedSegment !== null && stops.length > 0
    ? getSegmentLabel(
        highlightedSegment,
        stops.map((s) => ({ name: s.customerName ?? undefined })),
        depot?.name || t('map_depot_popup'),
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
      <div className={styles.zoomLevel}>Z {zoomLevel.toFixed(1)}</div>
      {stops.length === 0 && !isLoading && !selectedCandidate && (
        <div className={styles.emptyHint}>{t('map_empty_hint')}</div>
      )}
      {segmentInfo && (
        <div className={styles.segmentInfo}>
          <span className={styles.segmentInfoLabel}>
            {segmentInfo.fromName} → {segmentInfo.toName}
          </span>
          <button
            className={styles.segmentInfoClose}
            onClick={() => setHighlightedSegment(null)}
            title={t('map_clear_highlight')}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
