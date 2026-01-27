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

      // Fly to the marker
      map.current.flyTo({
        center: [lng, lat],
        zoom: MARKER_ZOOM,
        duration: 1000,
      });
    } else {
      // Reset to default view
      map.current.flyTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: 500,
      });
    }
  }, [lat, lng, mapLoaded, draggable, onPositionChange]);

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
      
      {!isGeocoding && lat === undefined && lng === undefined && (
        <div className={styles.placeholder}>
          <span className={styles.placeholderIcon}>📍</span>
          <p>Vyplňte adresu pro zobrazení polohy na mapě</p>
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
