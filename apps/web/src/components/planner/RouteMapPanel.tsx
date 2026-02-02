import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
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
}: RouteMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);

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

  // Clear all stop markers
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
  }, []);

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

  // Update route line
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove existing route
    if (mapRef.current.getLayer('route-line')) {
      mapRef.current.removeLayer('route-line');
    }
    if (mapRef.current.getSource('route')) {
      mapRef.current.removeSource('route');
    }

    if (stops.length === 0 || !depot) return;

    const coordinates: [number, number][] = routeGeometry && routeGeometry.length > 0
      ? routeGeometry
      : [
          [depot.lng, depot.lat],
          ...stops.map((s) => [s.coordinates.lng, s.coordinates.lat] as [number, number]),
          [depot.lng, depot.lat],
        ];

    mapRef.current.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    });

    mapRef.current.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
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

    // Fit bounds
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((coord) => bounds.extend(coord));
    mapRef.current.fitBounds(bounds, { padding: 50 });
  }, [stops, depot, routeGeometry]);

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
    </div>
  );
}
