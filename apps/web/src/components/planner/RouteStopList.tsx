/**
 * RouteStopList - Compact list of stops in the current route
 *
 * Displayed below the map in the center panel.
 * Shows ordered stops with ETA, remove button, metrics and route actions.
 */

import type { ReactNode } from 'react';
import type { MapStop } from './RouteMapPanel';
import type { RouteMetrics } from './CapacityMetrics';
import styles from './RouteStopList.module.css';

interface RouteStopListProps {
  stops: MapStop[];
  metrics: RouteMetrics | null;
  onRemoveStop?: (stopId: string) => void;
  onOptimize?: () => void;
  onClear?: () => void;
  isOptimizing?: boolean;
  isSaving?: boolean;
  jobProgress?: ReactNode;
}

export function RouteStopList({
  stops,
  metrics,
  onRemoveStop,
  onOptimize,
  onClear,
  isOptimizing = false,
  isSaving = false,
  jobProgress,
}: RouteStopListProps) {
  if (stops.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📋</span>
          <p>Zatím žádné zastávky v trase</p>
          <p>Vyberte kandidáty ze seznamu a přidejte je do trasy.</p>
        </div>
      </div>
    );
  }

  const formatTime = (time?: string) => {
    if (!time) return '';
    return time.substring(0, 5);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4>
          Zastávky v trase <span className={styles.stopCount}>({stops.length})</span>
        </h4>
      </div>

      <ul className={styles.stopList}>
        {stops.map((stop, index) => (
          <li key={stop.id} className={styles.stopItem}>
            <span className={styles.stopOrder}>{index + 1}</span>
            <div className={styles.stopInfo}>
              <div className={styles.stopName}>{stop.name}</div>
              <div className={styles.stopAddress}>{stop.address}</div>
              {stop.scheduledDate && (
                <div className={styles.scheduledWindow}>
                  <span className={styles.scheduledBadge}>
                    📅 {formatDate(stop.scheduledDate)}
                    {(stop.scheduledTimeStart || stop.scheduledTimeEnd) && (
                      <> {formatTime(stop.scheduledTimeStart)}{stop.scheduledTimeStart && stop.scheduledTimeEnd ? ' – ' : ''}{formatTime(stop.scheduledTimeEnd)}</>
                    )}
                  </span>
                </div>
              )}
              {(stop.eta || stop.etd) && (
                <div className={styles.stopTimeWindow}>
                  🕐 {formatTime(stop.eta)}{stop.eta && stop.etd ? ' – ' : ''}{formatTime(stop.etd)}
                </div>
              )}
            </div>
            {onRemoveStop && (
              <button
                type="button"
                className={styles.removeButton}
                onClick={() => onRemoveStop(stop.id)}
                title="Odebrat z trasy"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {metrics && (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{metrics.distanceKm.toFixed(1)} km</span>
            <span className={styles.metricLabel}>Vzdálenost</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>
              {metrics.travelTimeMin + metrics.serviceTimeMin > 0
                ? `${Math.round((metrics.travelTimeMin + metrics.serviceTimeMin) / 60 * 10) / 10} h`
                : '—'}
            </span>
            <span className={styles.metricLabel}>Celkový čas</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{metrics.loadPercent}%</span>
            <span className={styles.metricLabel}>Zatížení</span>
          </div>
        </div>
      )}

      {jobProgress && (
        <div className={styles.jobProgress}>{jobProgress}</div>
      )}

      <div className={styles.actions}>
        {onOptimize && (
          <button
            type="button"
            className={styles.optimizeButton}
            onClick={onOptimize}
            disabled={isOptimizing || stops.length < 2}
          >
            {isOptimizing ? 'Optimalizuji...' : '🚀 Optimalizovat'}
          </button>
        )}
        {isSaving && (
          <span className={styles.savingIndicator}>⟳ Ukládám...</span>
        )}
        {onClear && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={onClear}
          >
            🗑️ Vyčistit
          </button>
        )}
      </div>
    </div>
  );
}
