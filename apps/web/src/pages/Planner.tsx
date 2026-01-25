import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import styles from './Planner.module.css';

export function Planner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

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
      center: [14.4378, 50.0755], // Prague
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  return (
    <div className={styles.planner}>
      <div className={styles.sidebar}>
        <h2>Plánování trasy</h2>
        
        <div className={styles.dateSelector}>
          <label>Datum</label>
          <input type="date" defaultValue={new Date().toISOString().split('T')[0]} />
        </div>

        <div className={styles.stops}>
          <h3>Zastávky (0)</h3>
          <p className={styles.empty}>
            Přidejte revize k naplánování
          </p>
        </div>

        <div className={styles.actions}>
          <button className="btn-primary w-full">Optimalizovat trasu</button>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Celková vzdálenost</span>
            <span className={styles.statValue}>0 km</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Odhadovaný čas</span>
            <span className={styles.statValue}>0 min</span>
          </div>
        </div>
      </div>

      <div className={styles.mapWrapper}>
        <div ref={mapContainer} className={styles.map} />
      </div>
    </div>
  );
}
