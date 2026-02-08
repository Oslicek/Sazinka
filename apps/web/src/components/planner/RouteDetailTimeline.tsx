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

function formatScheduledDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function getStatusBadge(
  revisionStatus: string | null, 
  hasScheduledTime: boolean
): { label: string; className: string } {
  // If has scheduled time but status is not confirmed, treat as scheduled
  if (hasScheduledTime && revisionStatus !== 'confirmed' && revisionStatus !== 'completed' && revisionStatus !== 'cancelled') {
    return { label: 'Naplánováno', className: styles.badgeScheduled };
  }
  
  switch (revisionStatus) {
    case 'confirmed':
      return { label: 'Potvrzeno', className: styles.badgeConfirmed };
    case 'scheduled':
      return { label: 'Naplánováno', className: styles.badgeScheduled };
    case 'completed':
      return { label: 'Hotovo', className: styles.badgeCompleted };
    case 'cancelled':
      return { label: 'Zrušeno', className: styles.badgeCancelled };
    case 'upcoming':
    default:
      return { label: 'Nepotvrzeno', className: styles.badgePending };
  }
}

function calculateTimeDifference(time1: string | null, time2: string | null): number | null {
  if (!time1 || !time2) return null;
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  return Math.abs((h1 * 60 + m1) - (h2 * 60 + m2));
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
        const hasScheduledTime = !!(stop.scheduledTimeStart && stop.scheduledTimeEnd);
        const badge = getStatusBadge(stop.revisionStatus, hasScheduledTime);
        const isSelected = stop.customerId === selectedStopId;
        
        // Calculate time difference between scheduled and estimated
        const timeDiffStart = calculateTimeDifference(stop.scheduledTimeStart, stop.estimatedArrival);
        const timeDiffEnd = calculateTimeDifference(stop.scheduledTimeEnd, stop.estimatedDeparture);
        const hasSignificantDiff = (timeDiffStart && timeDiffStart > 15) || (timeDiffEnd && timeDiffEnd > 15);

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
                {stop.distanceFromPreviousKm != null && stop.distanceFromPreviousKm > 0 ? (
                  <span className={styles.segmentDistance}>{stop.distanceFromPreviousKm.toFixed(1)} km</span>
                ) : (
                  <span className={styles.segmentDistance}>—</span>
                )}
                <span className={styles.segmentSeparator}>•</span>
                {stop.durationFromPreviousMinutes != null && stop.durationFromPreviousMinutes > 0 ? (
                  <span className={styles.segmentDuration}>{stop.durationFromPreviousMinutes} min</span>
                ) : (
                  <span className={styles.segmentDuration}>—</span>
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
                
                {/* Show both scheduled and estimated times */}
                {hasScheduledTime ? (
                  <>
                    <div className={styles.timeRow}>
                      <span className={styles.timeLabel}>Dohodnuto:</span>
                      <div className={styles.stopTime}>
                        <span>{formatTime(stop.scheduledTimeStart)}</span>
                        <span className={styles.timeSeparator}>–</span>
                        <span>{formatTime(stop.scheduledTimeEnd)}</span>
                      </div>
                      {hasSignificantDiff && <span className={styles.warningIcon} title="Výrazný rozdíl oproti vypočítanému času">⚠️</span>}
                    </div>
                    {(stop.estimatedArrival || stop.estimatedDeparture) && (
                      <div className={styles.timeRow}>
                        <span className={styles.timeLabel}>Vypočítáno:</span>
                        <div className={styles.etaTime}>
                          <span>{formatTime(stop.estimatedArrival)}</span>
                          <span className={styles.timeSeparator}>–</span>
                          <span>{formatTime(stop.estimatedDeparture)}</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* No scheduled time - show only estimated */
                  <div className={styles.timeRow}>
                    <span className={styles.timeLabel}>Vypočítáno:</span>
                    <div className={styles.stopTime}>
                      <span>{formatTime(stop.estimatedArrival)}</span>
                      <span className={styles.timeSeparator}>–</span>
                      <span>{formatTime(stop.estimatedDeparture)}</span>
                    </div>
                  </div>
                )}
                
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
