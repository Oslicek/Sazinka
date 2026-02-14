/**
 * RouteDetailTimeline - Vertical timeline of a route with depot, stops and segments
 *
 * Shows depot → segment → stop → segment → stop → ... → depot.
 * Clicking a stop or segment highlights it on the map.
 */

import { useState, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { SavedRouteStop } from '../../services/routeService';
import type { RouteWarning } from '@shared/route';
import { reorderStops, needsScheduledTimeWarning } from './reorderStops';
import { ScheduledTimeWarning } from './ScheduledTimeWarning';
import styles from './RouteDetailTimeline.module.css';

interface RouteDetailTimelineProps {
  stops: SavedRouteStop[];
  depot: { name: string; lat: number; lng: number } | null;
  selectedStopId: string | null;
  highlightedSegment: number | null;
  onStopClick: (customerId: string, index: number) => void;
  onSegmentClick: (segmentIndex: number) => void;
  // Drag-and-drop reorder
  onReorder?: (newStops: SavedRouteStop[]) => void;
  // Editing actions (optional - Inbox and Planner can both provide these)
  onRemoveStop?: (stopId: string) => void;
  onUpdateBreak?: (stopId: string, patch: { breakTimeStart?: string; breakDurationMinutes?: number }) => void;
  isSaving?: boolean;
  // Warnings from solver (LATE_ARRIVAL, INSUFFICIENT_BUFFER, etc.)
  warnings?: RouteWarning[];
  routeStartTime?: string | null; // HH:MM, working day start
  routeEndTime?: string | null; // HH:MM, working day end
  /** Computed depot departure (backward-calculated from first scheduled stop). */
  depotDeparture?: string | null;
  returnToDepotDistanceKm?: number | null;
  returnToDepotDurationMinutes?: number | null;
}

function formatTime(time: string | null): string {
  if (!time) return '--:--';
  return time.substring(0, 5);
}

function parseTimeToMinutes(time: string): number | null {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationHm(durationMinutes: number | null): string {
  if (durationMinutes == null || durationMinutes <= 0) return '—';
  const h = Math.floor(durationMinutes / 60);
  const m = durationMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}min`;
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

function getWarningLabel(warningType: string): string {
  switch (warningType) {
    case 'LATE_ARRIVAL':
      return 'Pozdní příjezd';
    case 'INSUFFICIENT_BUFFER':
      return 'Nedostatečná rezerva';
    case 'TIME_WINDOW':
      return 'Mimo časové okno';
    default:
      return warningType;
  }
}

function getWarningIcon(warningType: string): string {
  switch (warningType) {
    case 'LATE_ARRIVAL':
      return '🔴';
    case 'INSUFFICIENT_BUFFER':
      return '🟡';
    default:
      return '⚠️';
  }
}

export function RouteDetailTimeline({
  stops,
  depot,
  selectedStopId,
  highlightedSegment,
  onStopClick,
  onSegmentClick,
  onReorder,
  onRemoveStop,
  onUpdateBreak,
  isSaving = false,
  warnings = [],
  returnToDepotDistanceKm = null,
  returnToDepotDurationMinutes = null,
}: RouteDetailTimelineProps) {
  const depotName = depot?.name ?? 'Depo';

  // DnD state
  const [pendingReorder, setPendingReorder] = useState<{
    from: number;
    to: number;
    stop: SavedRouteStop;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const sortableIds = useMemo(() => stops.map((s) => s.id), [stops]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const fromIndex = stops.findIndex((s) => s.id === active.id);
    const toIndex = stops.findIndex((s) => s.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;

    const warningStop = needsScheduledTimeWarning(stops, fromIndex, toIndex);
    if (warningStop) {
      setPendingReorder({ from: fromIndex, to: toIndex, stop: warningStop });
      return;
    }
    onReorder(reorderStops(stops, fromIndex, toIndex));
  }

  function confirmReorder() {
    if (!pendingReorder || !onReorder) return;
    onReorder(reorderStops(stops, pendingReorder.from, pendingReorder.to));
    setPendingReorder(null);
  }

  // Build per-stop warning map: stopIndex (0-based) → warnings[]
  const warningsByStop = new Map<number, RouteWarning[]>();
  for (const w of warnings) {
    if (w.stopIndex != null) {
      const existing = warningsByStop.get(w.stopIndex) ?? [];
      existing.push(w);
      warningsByStop.set(w.stopIndex, existing);
    }
  }

  if (stops.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Žádné zastávky v této trase.</div>
      </div>
    );
  }

  const mapSegmentIndexByStopIndex: Array<number | null> = (() => {
    let mapIndex = 0;
    return stops.map((stop) => {
      if (stop.customerLat == null || stop.customerLng == null) return null;
      const current = mapIndex;
      mapIndex += 1;
      return current;
    });
  })();

  return (
    <div className={styles.container}>
      {/* Start depot */}
      <div className={styles.depotCard}>
        <span className={styles.depotIcon}>&#x1F4CD;</span>
        <span className={styles.depotName}>{depotName}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      {stops.map((stop, index) => {
        const isBreak = stop.stopType === 'break';
        const hasScheduledTime = !!(stop.scheduledTimeStart && stop.scheduledTimeEnd);
        const badge = isBreak 
          ? { label: 'Pauza', className: styles.badgeBreak }
          : stop.status === 'unassigned'
            ? { label: 'Nezařazeno', className: styles.badgeUnassigned }
            : getStatusBadge(stop.revisionStatus, hasScheduledTime);
        const isSelected = stop.customerId === selectedStopId;
        
        // Calculate time difference between scheduled and estimated
        const timeDiffStart = calculateTimeDifference(stop.scheduledTimeStart, stop.estimatedArrival);
        const timeDiffEnd = calculateTimeDifference(stop.scheduledTimeEnd, stop.estimatedDeparture);
        const hasSignificantDiff = (timeDiffStart != null && timeDiffStart > 15) || (timeDiffEnd != null && timeDiffEnd > 15);

        const mapSegmentIndex = mapSegmentIndexByStopIndex[index];
        const isSegmentHighlighted = mapSegmentIndex != null && highlightedSegment === mapSegmentIndex;
        const segmentArrival = stop.estimatedArrival ?? null;
        const segmentDuration = stop.durationFromPreviousMinutes ?? null;

        const segmentStart = (() => {
          if (segmentArrival && segmentDuration != null) {
            const arrivalMin = parseTimeToMinutes(segmentArrival);
            if (arrivalMin != null) {
              return minutesToTime(arrivalMin - segmentDuration);
            }
          }
          return null;
        })();

        const segmentTimeRange =
          segmentStart && segmentArrival
            ? `${formatTime(segmentStart)}–${formatTime(segmentArrival)}`
            : '—';
        const segmentDistanceKm =
          stop.distanceFromPreviousKm != null && stop.distanceFromPreviousKm > 0
            ? stop.distanceFromPreviousKm
            : null;

        return (
          <div key={stop.id}>
            {/* Segment before this stop */}
            <div
              className={`${styles.segment} ${isSegmentHighlighted ? styles.segmentHighlighted : ''}`}
              onClick={() => {
                if (mapSegmentIndex != null) onSegmentClick(mapSegmentIndex);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (mapSegmentIndex != null) onSegmentClick(mapSegmentIndex);
                }
              }}
            >
              <div className={styles.segmentLine} />
              <div className={styles.segmentInfo}>
                <span className={styles.segmentTime}>{segmentTimeRange}</span>
                <span className={styles.segmentSeparator}>•</span>
                {segmentDistanceKm != null && segmentDistanceKm > 0 ? (
                  <span className={styles.segmentDistance}>{segmentDistanceKm.toFixed(1)} km</span>
                ) : (
                  <span className={styles.segmentDistance}>—</span>
                )}
                <span className={styles.segmentSeparator}>•</span>
                <span className={styles.segmentDuration}>{formatDurationHm(segmentDuration)}</span>
              </div>
            </div>

            {/* Stop card (or break card) */}
            {isBreak ? (
              <div className={`${styles.breakCard} ${isSelected ? styles.stopCardSelected : ''}`}>
                <div className={styles.breakIcon}>☕</div>
                <div className={styles.stopContent}>
                  <div className={styles.stopHeader}>
                    <span className={styles.stopName}>Pauza</span>
                    <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                  </div>
                  <div className={styles.breakMetaRow}>
                    <div className={styles.breakField}>
                      <span className={styles.breakFieldLabel}>Začátek:</span>
                      <div className={styles.stopTime}>
                        {onUpdateBreak ? (
                          <input
                            type="time"
                            className={styles.breakInput}
                            value={stop.breakTimeStart?.substring(0, 5) || '12:00'}
                            onChange={(e) => onUpdateBreak(stop.id, { breakTimeStart: e.target.value })}
                          />
                        ) : (
                          <span>{formatTime(stop.breakTimeStart || null)}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.breakField}>
                      <span className={styles.breakFieldLabel}>Délka:</span>
                      <div className={styles.stopTime}>
                        {onUpdateBreak ? (
                          <input
                            type="number"
                            min={1}
                            max={240}
                            className={styles.breakInputNumber}
                            value={stop.breakDurationMinutes ?? 30}
                            onChange={(e) =>
                              onUpdateBreak(stop.id, {
                                breakDurationMinutes: Math.max(1, parseInt(e.target.value || '30', 10)),
                              })
                            }
                          />
                        ) : (
                          <span>{stop.breakDurationMinutes ?? 30} min</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                </div>
                {onRemoveStop && (
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveStop(stop.id);
                    }}
                    title="Odstranit pauzu"
                  >
                    ✕
                  </button>
                )}
              </div>
            ) : (
              <div
                className={`${styles.stopCard} ${isSelected ? styles.stopCardSelected : ''} ${stop.status === 'unassigned' ? styles.stopCardUnassigned : ''}`}
                data-selected={isSelected}
                onClick={() => onStopClick(stop.customerId ?? '', index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onStopClick(stop.customerId ?? '', index);
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
                  
                  {/* Per-stop warnings (LATE_ARRIVAL, INSUFFICIENT_BUFFER) */}
                  {warningsByStop.has(index) && (
                    <div className={styles.stopWarnings}>
                      {warningsByStop.get(index)!.map((w, wi) => (
                        <div
                          key={wi}
                          className={`${styles.stopWarning} ${w.warningType === 'LATE_ARRIVAL' ? styles.stopWarningDanger : styles.stopWarningCaution}`}
                          title={w.message}
                        >
                          <span className={styles.stopWarningIcon}>{getWarningIcon(w.warningType)}</span>
                          <span>{getWarningLabel(w.warningType)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {onRemoveStop && (
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent triggering onStopClick
                      onRemoveStop(stop.id);
                    }}
                    title="Odebrat zastávku"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      </SortableContext>
      </DndContext>

      {/* Return segment to depot */}
      {(() => {
        const mappableStopCount = mapSegmentIndexByStopIndex.filter((v) => v != null).length;
        const returnSegmentIndex = mappableStopCount;
        const isReturnSegmentHighlighted = highlightedSegment === returnSegmentIndex;
        const lastStop = stops[stops.length - 1];
        const returnSegmentStart = lastStop.estimatedDeparture ?? null;
        const inferredReturnEnd = (() => {
          if (returnSegmentStart && returnToDepotDurationMinutes != null && returnToDepotDurationMinutes > 0) {
            const startMin = parseTimeToMinutes(returnSegmentStart);
            if (startMin != null) return minutesToTime(startMin + returnToDepotDurationMinutes);
          }
          return null;
        })();
        const returnDuration = returnToDepotDurationMinutes != null
          ? returnToDepotDurationMinutes
          : null;
        const returnDistance = returnToDepotDistanceKm != null
          ? returnToDepotDistanceKm
          : null;
        const returnTimeRange =
          returnSegmentStart && inferredReturnEnd
            ? `${formatTime(returnSegmentStart)}–${formatTime(inferredReturnEnd)}`
            : '—';

        return (
          <div
            className={`${styles.segment} ${isReturnSegmentHighlighted ? styles.segmentHighlighted : ''}`}
            onClick={() => onSegmentClick(returnSegmentIndex)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSegmentClick(returnSegmentIndex);
              }
            }}
          >
            <div className={styles.segmentLine} />
            <div className={styles.segmentInfo}>
              <span className={styles.segmentTime}>{returnTimeRange}</span>
              <span className={styles.segmentSeparator}>•</span>
              {returnDistance != null && returnDistance > 0 ? (
                <span className={styles.segmentDistance}>{returnDistance.toFixed(1)} km</span>
              ) : (
                <span className={styles.segmentDistance}>—</span>
              )}
              <span className={styles.segmentSeparator}>•</span>
              <span className={styles.segmentDuration}>{formatDurationHm(returnDuration)}</span>
            </div>
          </div>
        );
      })()}

      {/* End depot */}
      <div className={styles.depotCard}>
        <span className={styles.depotIcon}>&#x1F4CD;</span>
        <span className={styles.depotName}>{depotName}</span>
      </div>

      {isSaving && (
        <div className={styles.savingIndicator}>⟳ Ukládám...</div>
      )}

      {pendingReorder && (
        <ScheduledTimeWarning
          customerName={pendingReorder.stop.customerName ?? 'Neznámý'}
          scheduledTimeStart={pendingReorder.stop.scheduledTimeStart!}
          scheduledTimeEnd={pendingReorder.stop.scheduledTimeEnd ?? pendingReorder.stop.scheduledTimeStart!}
          onConfirm={confirmReorder}
          onCancel={() => setPendingReorder(null)}
        />
      )}
    </div>
  );
}
