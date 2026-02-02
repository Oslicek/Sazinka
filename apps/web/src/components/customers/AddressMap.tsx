import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './AddressMap.module.css';

interface AddressMapProps {
  /** Latitude of the marker */
  lat?: number;
  /** Longitude of the marker */
  lng?: number;
  /** Whether geocoding is in progress */
  isGeocoding?: boolean;
  /** Display name from geocoding */
  displayName?: string;
  /** Callback when marker is dragged to new position */
  onPositionChange?: (lat: number, lng: number) => void;
  /** Whether the marker can be dragged */
  draggable?: boolean;
  /** Placeholder text when no coordinates */
  emptyMessage?: string;
  /** Allow picking a point on the map */
  enablePick?: boolean;
  /** Callback when a point is picked */
  onPick?: (lat: number, lng: number) => void;
  /** Whether to auto-center map when coordinates change */
  autoCenter?: boolean;
  /** Called when user moves/zooms the map */
  onMapInteraction?: () => void;
  /** Callback after auto-centering completes */
  onAutoCenterComplete?: () => void;
}

// Default center: Czech Republic
const DEFAULT_CENTER: [number, number] = [15.5, 49.8];
const DEFAULT_ZOOM = 6;
const MARKER_ZOOM = 15;

export function AddressMap({
  lat,
  lng,
  isGeocoding = false,
  displayName,
  onPositionChange,
  draggable = true,
  emptyMessage = 'Vyplňte adresu pro zobrazení polohy na mapě',
  enablePick = false,
  onPick,
  autoCenter = true,
  onMapInteraction,
  onAutoCenterComplete,
}: AddressMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
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
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update marker when coordinates change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing marker
    if (marker.current) {
      marker.current.remove();
      marker.current = null;
    }

    // Add new marker if we have coordinates
    if (lat !== undefined && lng !== undefined) {
      marker.current = new maplibregl.Marker({
        draggable: draggable,
        color: '#2563eb',
      })
        .setLngLat([lng, lat])
        .addTo(map.current);

      // Handle drag end
      if (draggable && onPositionChange) {
        marker.current.on('dragend', () => {
          const lngLat = marker.current?.getLngLat();
          if (lngLat) {
            onPositionChange(lngLat.lat, lngLat.lng);
          }
        });
      }

      if (autoCenter) {
        // Fly to the marker
        map.current.flyTo({
          center: [lng, lat],
          zoom: MARKER_ZOOM,
          duration: 1000,
        });
        if (onAutoCenterComplete) {
          map.current.once('moveend', () => {
            onAutoCenterComplete();
          });
        }
      }
    } else if (autoCenter) {
      // Reset to default view
      map.current.flyTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: 500,
      });
    }
  }, [lat, lng, mapLoaded, draggable, onPositionChange, autoCenter]);

  // Allow picking a point on the map
  useEffect(() => {
    if (!map.current || !mapLoaded || !enablePick || !onPick) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const { lat, lng } = e.lngLat;
      onPick(lat, lng);
    };

    map.current.on('click', handleClick);

    return () => {
      map.current?.off('click', handleClick);
    };
  }, [mapLoaded, enablePick, onPick]);

  // Track user map interactions
  useEffect(() => {
    if (!map.current || !mapLoaded || !onMapInteraction) return;

    const handleInteraction = () => {
      onMapInteraction();
    };

    map.current.on('moveend', handleInteraction);
    map.current.on('zoomend', handleInteraction);
    map.current.on('dragend', handleInteraction);

    return () => {
      map.current?.off('moveend', handleInteraction);
      map.current?.off('zoomend', handleInteraction);
      map.current?.off('dragend', handleInteraction);
    };
  }, [mapLoaded, onMapInteraction]);

  return (
    <div className={styles.container}>
      <div ref={mapContainer} className={styles.map} />
      
      {isGeocoding && (
        <div className={styles.overlay}>
          <div className={styles.loading}>
            <span className={styles.spinner} />
            Hledám adresu...
          </div>
        </div>
      )}
      
      {!isGeocoding && lat === undefined && lng === undefined && emptyMessage && (
        <div className={styles.placeholder}>
          <span className={styles.placeholderIcon}>📍</span>
          <p>{emptyMessage}</p>
        </div>
      )}
      
      {displayName && lat !== undefined && lng !== undefined && (
        <div className={styles.info}>
          <span className={styles.infoIcon}>✓</span>
          <span className={styles.infoText}>{displayName}</span>
          {draggable && (
            <span className={styles.hint}>Přetáhněte značku pro úpravu polohy</span>
          )}
        </div>
      )}
    </div>
  );
}
