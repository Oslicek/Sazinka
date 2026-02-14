import type { RouteMetrics } from './CapacityMetrics';
import { formatMinutesHm } from '../../utils/timeFormatters';
import styles from './RouteSummaryStats.module.css';

export interface RouteSummaryStatsProps {
  /** Actual route start time (HH:MM) */
  routeStartTime: string | null;
  /** Actual route end time (HH:MM) */
  routeEndTime: string | null;
  /** Route metrics (travel, service, distance) */
  metrics: RouteMetrics | null;
  /** Number of stops (excluding breaks) */
  stopCount: number;
}

export function RouteSummaryStats({
  routeStartTime,
  routeEndTime,
  metrics,
  stopCount,
}: RouteSummaryStatsProps) {
  // Calculate total time from start/end if both available
  const totalTimeMinutes = (() => {
    if (routeStartTime && routeEndTime && stopCount > 0) {
      const [sh, sm] = routeStartTime.split(':').map(Number);
      const [eh, em] = routeEndTime.split(':').map(Number);
      const totalMin = (eh * 60 + em) - (sh * 60 + sm);
      return totalMin > 0 ? totalMin : null;
    }
    return null;
  })();

  return (
    <div className={styles.summaryStats}>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Začátek</span>
        <span className={styles.statValue}>{routeStartTime ?? '—'}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Konec</span>
        <span className={styles.statValue}>{routeEndTime ?? '—'}</span>
      </div>
      <span className={styles.statSep}>|</span>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Celkový čas</span>
        <span className={styles.statValue}>
          {totalTimeMinutes !== null
            ? formatMinutesHm(totalTimeMinutes)
            : metrics
            ? formatMinutesHm((metrics.travelTimeMin ?? 0) + (metrics.serviceTimeMin ?? 0))
            : '—'}
        </span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Práce</span>
        <span className={styles.statValue}>
          {metrics ? formatMinutesHm(metrics.serviceTimeMin) : '—'}
        </span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Jízda</span>
        <span className={styles.statValue}>
          {metrics ? formatMinutesHm(metrics.travelTimeMin) : '—'}
        </span>
      </div>
      <span className={styles.statSep}>|</span>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Zastávky</span>
        <span className={styles.statValue}>{stopCount}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Vzdálenost</span>
        <span className={styles.statValue}>
          {metrics ? `${metrics.distanceKm.toFixed(1)} km` : '—'}
        </span>
      </div>
    </div>
  );
}
