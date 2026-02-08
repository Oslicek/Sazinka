/**
 * RouteListPanel - List of planned routes with selection
 *
 * Displays route cards sorted by date/crew. Clicking a card selects it
 * and loads its detail in RouteDetailTimeline.
 */

import type { SavedRoute } from '../../services/routeService';
import styles from './RouteListPanel.module.css';

interface RouteListPanelProps {
  routes: SavedRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
  isLoading: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  return `${days[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m.toString().padStart(2, '0')}`;
}

export function RouteListPanel({
  routes,
  selectedRouteId,
  onSelectRoute,
  isLoading,
}: RouteListPanelProps) {
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Načítám cesty...</div>
      </div>
    );
  }

  if (routes.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Žádné naplánované cesty pro vybraný filtr.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {routes.map((route) => {
        const isSelected = route.id === selectedRouteId;
        return (
          <div
            key={route.id}
            className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
            data-selected={isSelected}
            onClick={() => onSelectRoute(route.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectRoute(route.id);
              }
            }}
          >
            <div className={styles.cardHeader}>
              <span className={styles.cardDate}>{formatDate(route.date)}</span>
              {route.crewName && (
                <span className={styles.cardCrew}>{route.crewName}</span>
              )}
            </div>
            <div className={styles.cardMetrics}>
              <span className={styles.metric}>
                <span className={styles.metricValue}>{route.stopsCount ?? 0}</span>
                <span className={styles.metricLabel}>zast.</span>
              </span>
              {route.totalDistanceKm != null && route.totalDistanceKm > 0 && (
                <span className={styles.metric}>
                  <span className={styles.metricValue}>{Math.round(route.totalDistanceKm)}</span>
                  <span className={styles.metricLabel}>km</span>
                </span>
              )}
              {route.totalDurationMinutes != null && route.totalDurationMinutes > 0 && (
                <span className={styles.metric}>
                  <span className={styles.metricValue}>{formatDuration(route.totalDurationMinutes)}</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
