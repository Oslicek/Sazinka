/**
 * PlanningTimeline — proportional-height timeline where element heights
 * represent real durations. Supports drag-and-drop reordering and
 * candidate insertion via gap zones.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SavedRouteStop } from '../../services/routeService';
import type { RouteWarning } from '@shared/route';
import { buildTimelineItems, type TimelineItem } from './buildTimelineItems';
import { snapToGrid, minutesToHm as snapMinutesToHm } from './snapToGrid';
import { reorderStops, needsScheduledTimeWarning } from './reorderStops';
import { ScheduledTimeWarning } from './ScheduledTimeWarning';
import styles from './PlanningTimeline.module.css';

// ---------------------------------------------------------------------------
// Candidate insertion info
// ---------------------------------------------------------------------------

export interface GapInsertionInfo {
  insertAfterIndex: number;
  candidateName: string;
  estimatedArrival?: string;
  estimatedDeparture?: string;
  deltaKm: number;
  deltaMin: number;
  status: 'ok' | 'tight' | 'conflict';
}

export interface CandidateForInsertion {
  candidateId: string;
  candidateName: string;
  gaps: GapInsertionInfo[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlanningTimelineProps {
  stops: SavedRouteStop[];
  depot: { name: string; lat: number; lng: number } | null;
  onStopClick: (customerId: string, index: number) => void;
  selectedStopId: string | null;
  // Editing
  onReorder?: (newStops: SavedRouteStop[]) => void;
  onRemoveStop?: (stopId: string) => void;
  onUpdateBreak?: (stopId: string, patch: { breakTimeStart?: string; breakDurationMinutes?: number }) => void;
  onUpdateTravelDuration?: (stopId: string, minutes: number) => void;
  onResetTravelDuration?: (stopId: string) => void;
  onUpdateServiceDuration?: (stopId: string, minutes: number) => void;
  onResetServiceDuration?: (stopId: string) => void;
  isSaving?: boolean;
  // Warnings
  warnings?: RouteWarning[];
  routeStartTime?: string | null;
  routeEndTime?: string | null;
  /** Computed depot departure (backward-calculated from first scheduled stop). */
  depotDeparture?: string | null;
  returnToDepotDistanceKm?: number | null;
  returnToDepotDurationMinutes?: number | null;
  // Candidate insertion
  candidateForInsertion?: CandidateForInsertion | null;
  onInsertCandidate?: (insertAfterIndex: number) => void;
  /**
   * Quick Gap Placement: called when a stop or break is dropped into a gap
   * WITHOUT triggering a full route recalculation. The callback receives the
   * updated stops array with provisional times already set.
   */
  onQuickPlaceInGap?: (newStops: SavedRouteStop[]) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIXELS_PER_MINUTE = 1.25;
const MIN_ITEM_HEIGHT = 20;
const MIN_STOP_HEIGHT = 56;
const MIN_GAP_HEIGHT = 24;
const DEPOT_CARD_HEIGHT = 32;

function heightForDuration(minutes: number, minH = MIN_ITEM_HEIGHT): number {
  return Math.max(minH, Math.round(minutes * PIXELS_PER_MINUTE));
}

function formatTime(time: string | null): string {
  if (!time) return '--:--';
  return time.substring(0, 5);
}

/** Parse "HH:MM" to total minutes from midnight. */
function parseHm(time: string): number {
  const parts = time.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function formatDurationHm(minutes: number): string {
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function formatDelta(value: number, unit: string): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}${unit}`;
}


// ---------------------------------------------------------------------------
// Sortable stop item (used inside DndContext)
// ---------------------------------------------------------------------------

function SortableStopCard({
  item,
  stopIndex,
  isSelected,
  onStopClick,
  onRemoveStop,
  onUpdateBreak,
  onUpdateServiceDuration,
  onResetServiceDuration,
}: {
  item: TimelineItem;
  stopIndex: number;
  isSelected: boolean;
  onStopClick: (customerId: string, index: number) => void;
  onRemoveStop?: (stopId: string) => void;
  onUpdateBreak?: (stopId: string, patch: { breakTimeStart?: string; breakDurationMinutes?: number }) => void;
  onUpdateServiceDuration?: (stopId: string, minutes: number) => void;
  onResetServiceDuration?: (stopId: string) => void;
}) {
  const { t } = useTranslation('planner');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const stop = item.stop!;
  const isBreak = item.type === 'break';
  const hasAgreedWindowOverlay = !isBreak && item.agreedWindowStart && item.agreedWindowEnd;
  const hasLateWarning = !isBreak && item.lateArrivalMinutes != null && item.lateArrivalMinutes > 0;
  const proportionalHeight = heightForDuration(item.durationMinutes, MIN_STOP_HEIGHT);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(hasLateWarning
      ? { minHeight: proportionalHeight }
      : { height: proportionalHeight, minHeight: MIN_STOP_HEIGHT }),
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isBreak ? styles.breakCard : styles.stopCard} ${isSelected ? styles.selected : ''} ${isDragging ? styles.dragging : ''} ${hasAgreedWindowOverlay ? styles.hasAgreedWindow : ''}`}
      onClick={() => !isBreak && stop.customerId && onStopClick(stop.customerId, stopIndex)}
      {...attributes}
    >
      {hasAgreedWindowOverlay && (
        <div className={styles.agreedWindowOverlay} aria-hidden="true">
          <span className={styles.agreedWindowText}>
            {t('planning_timeline_window', { start: item.agreedWindowStart, end: item.agreedWindowEnd })}
          </span>
        </div>
      )}
      <div className={styles.dragHandle} {...listeners}>
        <span className={styles.dragIcon}>
          <span className={styles.dragDot} />
          <span className={styles.dragDot} />
          <span className={styles.dragDot} />
          <span className={styles.dragDot} />
          <span className={styles.dragDot} />
          <span className={styles.dragDot} />
        </span>
      </div>

      {isBreak && <div className={styles.breakIcon}>☕</div>}

      <div className={styles.cardContent}>
        <div className={styles.cardHeader}>
          {isBreak ? (
            <>
              <span className={styles.cardName}>{t('timeline_break')}</span>
              <span className={styles.badgeBreak}>{t('timeline_break').toUpperCase()}</span>
            </>
          ) : (
            <>
              <span className={styles.cardOrder}>{stopIndex + 1}</span>
              <span className={styles.cardName}>{stop.customerName ?? t('timeline_unknown')}</span>
            </>
          )}
          {!isBreak && (
            <span className={`${styles.cardTime} ${item.lateArrivalMinutes ? styles.cardTimeLate : ''}`}>
              {formatTime(item.startTime)} – {formatTime(item.endTime)}
            </span>
          )}
        </div>
        {isBreak && (
          <div className={styles.breakMetaRow}>
            <div className={styles.breakField}>
              <span className={styles.breakFieldLabel}>{t('timeline_break_start')}</span>
              <div>
                {onUpdateBreak ? (
                  <input
                    type="time"
                    className={styles.breakInput}
                    value={stop.breakTimeStart?.substring(0, 5) || '12:00'}
                    onChange={(e) => onUpdateBreak(stop.id, { breakTimeStart: e.target.value })}
                  />
                ) : (
                  <span className={styles.breakFieldValue}>{formatTime(stop.breakTimeStart || null)}</span>
                )}
              </div>
            </div>
            <div className={styles.breakField}>
              <span className={styles.breakFieldLabel}>{t('timeline_break_duration')}</span>
              <div>
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
                  <span className={styles.breakFieldValue}>{stop.breakDurationMinutes ?? 30} min</span>
                )}
              </div>
            </div>
          </div>
        )}
        {!isBreak && stop.address && (
          <div className={styles.cardAddress}>{stop.address}</div>
        )}
        {!isBreak && item.durationMinutes > 0 && (
          <div className={styles.cardDuration}>
            {onUpdateServiceDuration ? (
              <span className={styles.inlineEditGroup}>
                <input
                  type="number"
                  className={styles.inlineInput}
                  value={stop.overrideServiceDurationMinutes ?? stop.serviceDurationMinutes ?? 30}
                  min={1}
                  max={480}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value || '30', 10));
                    onUpdateServiceDuration(stop.id, val);
                  }}
                />
                <span className={styles.inlineUnit}>min</span>
                {stop.overrideServiceDurationMinutes != null && onResetServiceDuration && (
                  <button
                    type="button"
                    className={styles.overrideReset}
                    onClick={(e) => { e.stopPropagation(); onResetServiceDuration(stop.id); }}
                    title={t('override_reset_tooltip')}
                  >⚠️</button>
                )}
              </span>
            ) : (
              <span>{formatDurationHm(item.durationMinutes)}</span>
            )}
          </div>
        )}
        {item.lateArrivalMinutes != null && item.lateArrivalMinutes > 0 && (
          <div className={styles.lateWarning}>
            <span className={styles.lateWarningIcon}>&#x26A0;</span>
            {t('planning_timeline_late_arrival', {
              time: formatTime(item.actualArrivalTime ?? null),
              delay: formatDurationHm(item.lateArrivalMinutes),
            })}
          </div>
        )}
        {item.needsReschedule && (
          <div className={styles.needsRescheduleWarning}>
            <span className={styles.lateWarningIcon}>&#x26A0;</span>
            {t('needs_reschedule')}
          </div>
        )}
      </div>

      {onRemoveStop && (
        <button
          type="button"
          className={styles.removeButton}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveStop(stop.id);
          }}
          title={isBreak ? t('planning_timeline_remove_break') : t('planning_timeline_remove_stop')}
        >
          &#x2715;
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DroppableGap — gap zone that accepts break drops
// ---------------------------------------------------------------------------

function DroppableGap({
  item,
  gapInfo,
  isDraggingAny,
  candidateForInsertion,
  onInsertCandidate,
  formatTime,
  formatDurationHm,
  formatDelta,
  styles: s,
}: {
  item: TimelineItem;
  gapInfo: GapInsertionInfo | undefined;
  isDraggingAny: boolean;
  candidateForInsertion?: CandidateForInsertion | null;
  onInsertCandidate?: (insertAfterIndex: number) => void;
  formatTime: (t: string | null) => string;
  formatDurationHm: (m: number) => string;
  formatDelta: (v: number, u: string) => string;
  styles: Record<string, string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: item.id });
  const highlight = isDraggingAny && isOver;

  return (
    <div
      ref={setNodeRef}
      className={`${s.gapZone} ${gapInfo ? s.gapZoneActive : ''} ${isDraggingAny ? s.gapZoneReady : ''} ${highlight ? s.gapZoneDropTarget : ''}`}
      style={{ height: Math.max(24, Math.round(item.durationMinutes * 1.25)) }}
      onClick={() => {
        if (gapInfo && onInsertCandidate) {
          onInsertCandidate(item.insertAfterIndex!);
        }
      }}
    >
      <div className={s.gapContent}>
        <span className={s.gapDuration}>
          {formatTime(item.startTime)} – {formatTime(item.endTime)}
          {' '}({formatDurationHm(item.durationMinutes)})
        </span>
        {gapInfo && (
          <div className={s.gapCandidate}>
            <span className={s.gapCandidateName}>
              + {candidateForInsertion!.candidateName}
            </span>
            {gapInfo.estimatedArrival && (
              <span className={s.gapCandidateTime}>
                ETA {gapInfo.estimatedArrival}
                {gapInfo.estimatedDeparture && ` – ${gapInfo.estimatedDeparture}`}
              </span>
            )}
            <span className={`${s.gapCandidateDelta} ${s[`status_${gapInfo.status}`]}`}>
              {formatDelta(gapInfo.deltaMin, ' min')} / {formatDelta(gapInfo.deltaKm, ' km')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * After a DnD reorder, clear stale timing fields on the moved stop if it's a
 * break. Without this, buildTimelineItems would see the old breakTimeStart /
 * estimatedArrival and either create a huge gap or misplace the break.
 * The next recalculation will fill in correct values.
 */
function clearStaleBreakTimes(reordered: SavedRouteStop[], movedStop: SavedRouteStop | undefined): SavedRouteStop[] {
  if (!movedStop || movedStop.stopType !== 'break') return reordered;
  return reordered.map((s) =>
    s.id === movedStop.id
      ? { ...s, breakTimeStart: null, estimatedArrival: null, estimatedDeparture: null }
      : s,
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PlanningTimeline({
  stops,
  depot,
  onStopClick,
  selectedStopId,
  onReorder,
  onRemoveStop,
  onUpdateBreak,
  onUpdateTravelDuration,
  onResetTravelDuration,
  onUpdateServiceDuration,
  onResetServiceDuration,
  isSaving = false,
  routeStartTime,
  routeEndTime,
  // depotDeparture — available in interface, consumed by parent for RouteSummaryStats
  returnToDepotDistanceKm,
  returnToDepotDurationMinutes,
  candidateForInsertion,
  onInsertCandidate,
  onQuickPlaceInGap,
}: PlanningTimelineProps) {
  const { t } = useTranslation('planner');
  const depotName = depot?.name ?? 'Depo';
  const workdayStart = routeStartTime ?? '08:00';
  const workdayEnd = routeEndTime ?? '16:00';

  // Pending DnD warning
  const [pendingReorder, setPendingReorder] = useState<{
    from: number;
    to: number;
    stop: SavedRouteStop;
  } | null>(null);

  // Track the actively dragged stop (for DragOverlay and gap zone highlighting)
  const [activeDragStop, setActiveDragStop] = useState<SavedRouteStop | null>(null);
  const isDraggingAny = activeDragStop != null;

  // Build timeline items
  const timelineItems = useMemo(
    () =>
      buildTimelineItems(
        stops,
        workdayStart,
        workdayEnd,
        returnToDepotDistanceKm != null && returnToDepotDurationMinutes != null
          ? { distanceKm: returnToDepotDistanceKm, durationMinutes: returnToDepotDurationMinutes }
          : undefined,
      ),
    [stops, workdayStart, workdayEnd, returnToDepotDistanceKm, returnToDepotDurationMinutes],
  );

  // The timeline item for the active drag (for DragOverlay rendering)
  const activeDragItem = activeDragStop
    ? timelineItems.find((it) => it.id === activeDragStop.id) ?? null
    : null;

  // Sortable IDs = only stops and breaks
  const sortableIds = useMemo(
    () => stops.map((s) => s.id),
    [stops],
  );

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Custom collision: prefer pointer-within hit, fall back to closest center.
  // This ensures dragging an item past non-sortable elements (travel, gap) still
  // registers a drop target correctly.
  const collisionDetection: CollisionDetection = (args) => {
    const pointerHits = pointerWithin(args);
    if (pointerHits.length > 0) return pointerHits;
    const intersections = rectIntersection(args);
    if (intersections.length > 0) return intersections;
    return closestCenter(args);
  };

  function handleDragStart(event: DragStartEvent) {
    const dragged = stops.find((s) => s.id === event.active.id) ?? null;
    setActiveDragStop(dragged);
  }

  // DnD handler
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragStop(null);
    const { active, over, delta } = event;
    if (!over || active.id === over.id || !onReorder) return;

    // --- Drop on a gap: Quick Gap Placement (no recalculation) ---
    const overId = String(over.id);
    if (overId.startsWith('gap-') || overId.startsWith('gap-before-') || overId.startsWith('gap-after-')) {
      const droppedStop = stops.find((s) => s.id === active.id);
      if (!droppedStop) return;

      // Find the gap item in the timeline to get its time bounds
      const gapItem = timelineItems.find((it) => it.id === overId);
      if (!gapItem || !gapItem.startTime || !gapItem.endTime) return;

      const gapStartMin = parseHm(gapItem.startTime);
      const gapEndMin = parseHm(gapItem.endTime);

      // Determine item duration
      const itemDuration = droppedStop.stopType === 'break'
        ? (droppedStop.breakDurationMinutes ?? 30)
        : (droppedStop.serviceDurationMinutes ?? droppedStop.overrideServiceDurationMinutes ?? 30);

      // Compute where the pointer is within the gap's bounding rect.
      const pointerY = (event.activatorEvent as PointerEvent).clientY + delta.y;
      const gapRect = over.rect;
      const fractionInGap = gapRect.height > 0
        ? Math.max(0, Math.min(1, (pointerY - gapRect.top) / gapRect.height))
        : 0.5;
      const rawStartMin = gapStartMin + Math.round(fractionInGap * (gapEndMin - gapStartMin));

      // Snap to 15-minute grid
      const snappedStartMin = snapToGrid(rawStartMin, itemDuration, gapStartMin, gapEndMin);
      if (snappedStartMin === null) return;

      const snappedEndMin = snappedStartMin + itemDuration;
      const startHm = snapMinutesToHm(snappedStartMin);
      const endHm = snapMinutesToHm(snappedEndMin);

      // The gap ID is `gap-{i}` where i is the stops-array index of the
      // stop this gap appears before. Use that stop as the insertion anchor.
      // If stops[i] is the dragged item itself, skip it and use the next stop.
      const gapStopIdx = parseInt(overId.replace(/^gap-/, ''), 10);
      let anchorStop: SavedRouteStop | undefined;
      if (Number.isFinite(gapStopIdx)) {
        for (let k = gapStopIdx; k < stops.length; k++) {
          if (stops[k].id !== droppedStop.id) {
            anchorStop = stops[k];
            break;
          }
        }
      }

      // Remove the dragged stop from its current position
      const newStops = stops.filter((s) => s.id !== droppedStop.id);

      // Insert just before the anchor stop (the stop after the gap)
      const insertionPoint = anchorStop
        ? newStops.findIndex((s) => s.id === anchorStop.id)
        : newStops.length;

      let updatedStop: SavedRouteStop;
      if (droppedStop.stopType === 'break') {
        updatedStop = {
          ...droppedStop,
          breakTimeStart: startHm,
          estimatedArrival: startHm,
          estimatedDeparture: endHm,
          // Clear travel metrics — they'll be recalculated on next recalc
          durationFromPreviousMinutes: null,
          distanceFromPreviousKm: null,
        };
      } else {
        // Customer stop: set provisional times and flag for renegotiation
        updatedStop = {
          ...droppedStop,
          estimatedArrival: startHm,
          estimatedDeparture: endHm,
          scheduledTimeStart: startHm,
          scheduledTimeEnd: endHm,
          needsReschedule: true,
          // Clear travel metrics
          durationFromPreviousMinutes: null,
          distanceFromPreviousKm: null,
        };
      }

      newStops.splice(insertionPoint, 0, updatedStop);
      const reindexed = newStops.map((s, i) => ({ ...s, stopOrder: i + 1 }));

      // Use onQuickPlaceInGap if available (no recalc), otherwise fall back to onReorder
      if (onQuickPlaceInGap) {
        onQuickPlaceInGap(reindexed);
      } else if (onReorder) {
        onReorder(reindexed);
      }
      return;
    }

    const fromIndex = stops.findIndex((s) => s.id === active.id);
    const overIndex = stops.findIndex((s) => s.id === over.id);
    if (fromIndex === -1 || overIndex === -1) return;

    // Determine the correct target index based on drag direction.
    // Without a sorting strategy, @dnd-kit only tells us which item the
    // pointer is over, not whether we should insert before or after it.
    // Use delta.y (total vertical drag distance) to infer intent:
    //   dragged upward (delta.y < 0) → place before the over item
    //   dragged downward (delta.y > 0) → place after the over item
    let toIndex: number;
    if (delta.y < 0) {
      // Dragged upward: place before the over item
      toIndex = fromIndex > overIndex ? overIndex : overIndex - 1;
    } else {
      // Dragged downward: place after the over item
      toIndex = fromIndex < overIndex ? overIndex : overIndex + 1;
    }
    // Clamp to valid range
    toIndex = Math.max(0, Math.min(toIndex, stops.length - 1));

    if (fromIndex === toIndex) return;

    const warningStop = needsScheduledTimeWarning(stops, fromIndex, toIndex);
    if (warningStop) {
      setPendingReorder({ from: fromIndex, to: toIndex, stop: warningStop });
      return;
    }

    onReorder(clearStaleBreakTimes(reorderStops(stops, fromIndex, toIndex), stops[fromIndex]));
  }

  function confirmReorder() {
    if (!pendingReorder || !onReorder) return;
    onReorder(clearStaleBreakTimes(reorderStops(stops, pendingReorder.from, pendingReorder.to), stops[pendingReorder.from]));
    setPendingReorder(null);
  }

  // Map gap insertAfterIndex → insertion info
  const gapInsertionMap = useMemo(() => {
    if (!candidateForInsertion) return new Map<number, GapInsertionInfo>();
    const map = new Map<number, GapInsertionInfo>();
    for (const gap of candidateForInsertion.gaps) {
      map.set(gap.insertAfterIndex, gap);
    }
    return map;
  }, [candidateForInsertion]);

  // Keep a running stop index counter for mapping timeline items to stop indices
  let stopIndex = -1;

  // Compute hour labels from workday start to workday end
  const hourLabels = useMemo(() => {
    const startMin = parseHm(workdayStart);
    const endMin = parseHm(workdayEnd);
    const labels: { hour: number; label: string }[] = [];
    // Start from the next full hour after workday start
    const firstHour = Math.ceil(startMin / 60);
    const lastHour = Math.floor(endMin / 60);
    for (let h = firstHour; h <= lastHour; h++) {
      labels.push({ hour: h, label: `${String(h).padStart(2, '0')}:00` });
    }
    return labels;
  }, [workdayStart, workdayEnd]);

  // Compute cumulative pixel offsets for each timeline item to position hour labels.
  // Heights must match the actual rendered heights exactly.
  const itemOffsets = useMemo(() => {
    const offsets: { startPx: number; endPx: number; startMin: number; endMin: number }[] = [];
    let px = 0;
    for (const item of timelineItems) {
      const sMin = item.startTime ? parseHm(item.startTime) : 0;
      const eMin = item.endTime ? parseHm(item.endTime) : sMin;
      let h: number;
      if (item.type === 'depot') {
        h = DEPOT_CARD_HEIGHT;
      } else if (item.type === 'gap') {
        h = Math.max(MIN_GAP_HEIGHT, Math.round(item.durationMinutes * PIXELS_PER_MINUTE));
      } else if (item.type === 'travel') {
        // 0-duration travel items are not rendered (return null)
        h = item.durationMinutes === 0 ? 0 : heightForDuration(item.durationMinutes, 8);
      } else {
        h = heightForDuration(item.durationMinutes, MIN_STOP_HEIGHT);
      }
      offsets.push({ startPx: px, endPx: px + h, startMin: sMin, endMin: eMin });
      px += h;
    }
    return offsets;
  }, [timelineItems]);

  // Map hour → pixel offset by interpolating within timeline items
  const hourPositions = useMemo(() => {
    const positions: { label: string; px: number }[] = [];
    for (const { hour, label } of hourLabels) {
      const targetMin = hour * 60;
      // Find the timeline item that spans this minute
      let px: number | null = null;
      for (const off of itemOffsets) {
        if (off.startMin <= targetMin && off.endMin >= targetMin && off.endMin > off.startMin) {
          const frac = (targetMin - off.startMin) / (off.endMin - off.startMin);
          px = off.startPx + frac * (off.endPx - off.startPx);
          break;
        }
      }
      if (px === null) {
        // Fallback: find closest item
        for (const off of itemOffsets) {
          if (off.startMin >= targetMin) {
            px = off.startPx;
            break;
          }
        }
      }
      if (px != null) {
        positions.push({ label, px });
      }
    }
    return positions;
  }, [hourLabels, itemOffsets]);

  const totalTimelineHeight = itemOffsets.length > 0 ? itemOffsets[itemOffsets.length - 1].endPx : 0;

  if (stops.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>{t('timeline_empty')}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd} onDragStart={handleDragStart} onDragCancel={() => setActiveDragStop(null)}>
        <SortableContext items={sortableIds}>
          <div className={styles.timeline}>
            <div className={styles.timelineWithLabels}>
              {/* Hour labels gutter */}
              <div className={styles.hourGutter} style={{ height: totalTimelineHeight }}>
                {hourPositions.map(({ label, px }) => (
                  <div
                    key={label}
                    className={styles.hourLabel}
                    style={{ top: px }}
                  >
                    <span className={styles.hourText}>{label}</span>
                    <div className={styles.hourTick} />
                  </div>
                ))}
              </div>
              {/* Timeline content */}
              <div className={styles.timelineContent}>
            {timelineItems.map((item) => {
              switch (item.type) {
                case 'depot':
                  return (
                    <div key={item.id} className={styles.depotCard}>
                      <span className={styles.depotIcon}>&#x1F4CD;</span>
                      <span className={styles.depotName}>{depotName}</span>
                      <span className={styles.depotTime}>{formatTime(item.startTime)}</span>
                    </div>
                  );

                case 'travel':
                  if (item.durationMinutes === 0) return null;
                  return (
                    <div
                      key={item.id}
                      className={styles.travelSegment}
                      style={{ height: heightForDuration(item.durationMinutes, 8) }}
                    >
                      <div className={styles.travelLine} />
                      {item.durationMinutes > 0 && (
                        <div className={styles.travelInfo}>
                          {onUpdateTravelDuration && item.destinationStopId ? (
                            <span className={styles.inlineEditGroup}>
                              <input
                                type="number"
                                className={styles.inlineInput}
                                value={item.overrideTravelDurationMinutes ?? item.durationMinutes ?? 0}
                                min={0}
                                max={999}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value || '0', 10));
                                  onUpdateTravelDuration(item.destinationStopId!, val);
                                }}
                              />
                              <span className={styles.inlineUnit}>min</span>
                              {item.overrideTravelDurationMinutes != null && onResetTravelDuration && (
                                <button
                                  type="button"
                                  className={styles.overrideReset}
                                  onClick={(e) => { e.stopPropagation(); onResetTravelDuration(item.destinationStopId!); }}
                                  title={t('override_reset_tooltip')}
                                >⚠️</button>
                              )}
                            </span>
                          ) : (
                            <span>{formatDurationHm(item.durationMinutes)}</span>
                          )}
                          {item.distanceKm != null && item.distanceKm > 0 && (
                            <span> &middot; {item.distanceKm.toFixed(1)} km</span>
                          )}
                        </div>
                      )}
                    </div>
                  );

                case 'gap': {
                  const gapInfo = gapInsertionMap.get(item.insertAfterIndex!);
                  return (
                    <DroppableGap
                      key={item.id}
                      item={item}
                      gapInfo={gapInfo}
                      isDraggingAny={isDraggingAny}
                      candidateForInsertion={candidateForInsertion}
                      onInsertCandidate={onInsertCandidate}
                      formatTime={formatTime}
                      formatDurationHm={formatDurationHm}
                      formatDelta={formatDelta}
                      styles={styles as unknown as Record<string, string>}
                    />
                  );
                }

                case 'stop':
                case 'break': {
                  stopIndex++;
                  const currentStopIndex = stopIndex;
                  return (
                    <SortableStopCard
                      key={item.id}
                      item={item}
                      stopIndex={currentStopIndex}
                      isSelected={item.stop?.customerId === selectedStopId}
                      onStopClick={onStopClick}
                      onRemoveStop={onRemoveStop}
                      onUpdateBreak={onUpdateBreak}
                      onUpdateServiceDuration={onUpdateServiceDuration}
                      onResetServiceDuration={onResetServiceDuration}
                    />
                  );
                }

                default:
                  return null;
              }
            })}
              </div>
            </div>
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeDragItem && (
            <div className={activeDragItem.type === 'break' ? styles.dragOverlayBreak : styles.dragOverlayStop}>
              {activeDragItem.type === 'break' ? (
                <>
                  <span className={styles.dragOverlayIcon}>&#x2615;</span>
                  <span className={styles.dragOverlayLabel}>
                    {activeDragItem.startTime ?? ''} &ndash; {activeDragItem.endTime ?? ''}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.dragOverlayOrder}>{activeDragItem.stop?.stopOrder}</span>
                  <span className={styles.dragOverlayLabel}>
                    {activeDragItem.stop?.customerName ?? ''}
                  </span>
                  <span className={styles.dragOverlayTime}>
                    {activeDragItem.startTime ?? ''}
                  </span>
                </>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {isSaving && <div className={styles.savingIndicator}>{t('timeline_saving')}</div>}

      {/* Scheduled-time warning dialog */}
      {pendingReorder && (
        <ScheduledTimeWarning
          customerName={pendingReorder.stop.customerName ?? t('timeline_unknown')}
          scheduledTimeStart={pendingReorder.stop.scheduledTimeStart!}
          scheduledTimeEnd={pendingReorder.stop.scheduledTimeEnd ?? pendingReorder.stop.scheduledTimeStart!}
          onConfirm={confirmReorder}
          onCancel={() => setPendingReorder(null)}
        />
      )}
    </div>
  );
}
