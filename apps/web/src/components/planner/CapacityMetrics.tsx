import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, AlertTriangle, X as XIcon } from 'lucide-react';
import styles from './CapacityMetrics.module.css';

export interface RouteMetrics {
  /** Total distance in kilometers */
  distanceKm: number;
  /** Total travel time in minutes */
  travelTimeMin: number;
  /** Total service time in minutes */
  serviceTimeMin: number;
  /** Utilization percentage (0-100+) */
  loadPercent: number;
  /** Minimum slack between visits in minutes */
  slackMin: number;
  /** Number of stops */
  stopCount: number;
}

type CapacityStatus = 'ok' | 'tight' | 'overloaded';

interface CapacityMetricsProps {
  metrics: RouteMetrics;
  showTooltips?: boolean;
}

function getLoadStatus(loadPercent: number): CapacityStatus {
  if (loadPercent < 80) return 'ok';
  if (loadPercent <= 95) return 'tight';
  return 'overloaded';
}

function getSlackStatus(slackMin: number): CapacityStatus {
  if (slackMin > 30) return 'ok';
  if (slackMin >= 15) return 'tight';
  return 'overloaded';
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h${mins.toString().padStart(2, '0')}`;
}

function getStatusIcon(status: CapacityStatus): ReactNode {
  switch (status) {
    case 'ok': return <Check size={14} />;
    case 'tight': return <AlertTriangle size={14} />;
    case 'overloaded': return <XIcon size={14} />;
  }
}

export function CapacityMetrics({ metrics, showTooltips = true }: CapacityMetricsProps) {
  const { t } = useTranslation('planner');
  const loadStatus = getLoadStatus(metrics.loadPercent);
  const slackStatus = getSlackStatus(metrics.slackMin);

  return (
    <div className={styles.metrics}>
      <div 
        className={styles.metric}
        title={showTooltips ? t('capacity_distance') : undefined}
      >
        <span className={styles.value}>{Math.round(metrics.distanceKm)} km</span>
      </div>

      <span className={styles.separator}>•</span>

      <div 
        className={styles.metric}
        title={showTooltips ? t('capacity_travel_tooltip') : undefined}
      >
        <span className={styles.label}>{t('capacity_travel')}</span>
        <span className={styles.value}>{formatDuration(metrics.travelTimeMin)}</span>
      </div>

      <span className={styles.separator}>•</span>

      <div 
        className={styles.metric}
        title={showTooltips ? t('capacity_service_tooltip') : undefined}
      >
        <span className={styles.label}>{t('capacity_service')}</span>
        <span className={styles.value}>{formatDuration(metrics.serviceTimeMin)}</span>
      </div>

      <span className={styles.separator}>•</span>

      <div 
        className={`${styles.metric} ${styles[loadStatus]}`}
        title={showTooltips ? t('capacity_utilization_tooltip') : undefined}
      >
        <span className={styles.label}>{t('capacity_utilization')}</span>
        <span className={styles.value}>
          {Math.round(metrics.loadPercent)}%
          <span className={styles.statusIcon}>{getStatusIcon(loadStatus)}</span>
        </span>
      </div>

      <span className={styles.separator}>•</span>

      <div 
        className={`${styles.metric} ${styles[slackStatus]}`}
        title={showTooltips ? t('capacity_slack_tooltip') : undefined}
      >
        <span className={styles.label}>{t('capacity_slack')}</span>
        <span className={styles.value}>
          {formatDuration(metrics.slackMin)}
          <span className={styles.statusIcon}>{getStatusIcon(slackStatus)}</span>
        </span>
      </div>

      <span className={styles.separator}>•</span>

      <div 
        className={styles.metric}
        title={showTooltips ? t('capacity_stops_tooltip') : undefined}
      >
        <span className={styles.value}>{t('capacity_stops', { count: metrics.stopCount })}</span>
      </div>
    </div>
  );
}
