/**
 * RouteDetailTimeline - Vertical timeline of a route with depot, stops and segments
 *
 * Shows depot → segment → stop → segment → stop → ... → depot.
 * Clicking a stop or segment highlights it on the map.
 */

import type { SavedRoute, SavedRouteStop } from '../../services/routeService';
import styles from './RouteDetailTimeline.module.css';

interface RouteDetailTimelineProps {
  route: SavedRoute;
  stops: SavedRouteStop[];
  depot: { name: string; lat: number; lng: number } | null;
  selectedStopId: string | null;
  onStopClick: (customerId: string, index: number) => void;
  onSegmentClick: (segmentIndex: number) => void;
}

function formatTime(time: string | null): string {
  if (!time) return '--:--';
  return time.substring(0, 5);
}

function getStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'confirmed':
      return { label: 'Potvrzeno', className: styles.badgeConfirmed };
    case 'completed':
      return { label: 'Hotovo', className: styles.badgeCompleted };
    case 'arrived':
      return { label: 'Na místě', className: styles.badgeArrived };
    case 'skipped':
      return { label: 'Přeskočeno', className: styles.badgeSkipped };
    default:
      return { label: 'Nepotvrzeno', className: styles.badgePending };
  }
}

export function RouteDetailTimeline({
  route: _route,
  stops,
  depot,
  selectedStopId,
  onStopClick,
  onSegmentClick,
}: RouteDetailTimelineProps) {
  const depotName = depot?.name ?? 'Depo';

  if (stops.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Žádné zastávky v této trase.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Start depot */}
      <div className={styles.depotCard}>
        <span className={styles.depotIcon}>&#x1F4CD;</span>
        <span className={styles.depotName}>{depotName}</span>
      </div>

      {stops.map((stop, index) => {
        const badge = getStatusBadge(stop.status);
        const isSelected = stop.customerId === selectedStopId;

        return (
          <div key={stop.id}>
            {/* Segment before this stop */}
            <div
              className={styles.segment}
              onClick={() => onSegmentClick(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSegmentClick(index);
                }
              }}
            >
              <div className={styles.segmentLine} />
              <div className={styles.segmentInfo}>
                {stop.distanceFromPreviousKm != null && (
                  <span>{stop.distanceFromPreviousKm.toFixed(1)} km</span>
                )}
                {stop.durationFromPreviousMinutes != null && (
                  <span>{stop.durationFromPreviousMinutes} min</span>
                )}
              </div>
            </div>

            {/* Stop card */}
            <div
              className={`${styles.stopCard} ${isSelected ? styles.stopCardSelected : ''}`}
              data-selected={isSelected}
              onClick={() => onStopClick(stop.customerId, index)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onStopClick(stop.customerId, index);
                }
              }}
            >
              <div className={styles.stopOrder}>{index + 1}</div>
              <div className={styles.stopContent}>
                <div className={styles.stopHeader}>
                  <span className={styles.stopName}>{stop.customerName}</span>
                  <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                </div>
                <div className={styles.stopTime}>
                  <span>{formatTime(stop.estimatedArrival)}</span>
                  <span className={styles.timeSeparator}>–</span>
                  <span>{formatTime(stop.estimatedDeparture)}</span>
                </div>
                <div className={styles.stopAddress}>{stop.address}</div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Return segment to depot */}
      <div className={styles.segment}>
        <div className={styles.segmentLine} />
      </div>

      {/* End depot */}
      <div className={styles.depotCard}>
        <span className={styles.depotIcon}>&#x1F4CD;</span>
        <span className={styles.depotName}>{depotName}</span>
      </div>
    </div>
  );
}
