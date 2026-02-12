/**
 * PlanningTimeline — proportional-height timeline where element heights
 * represent real durations. Supports drag-and-drop reordering and
 * candidate insertion via gap zones.
 */

import { useMemo, useState } from 'react';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SavedRouteStop } from '../../services/routeService';
import type { RouteMetrics } from './CapacityMetrics';
import type { RouteWarning } from '@shared/route';
import { buildTimelineItems, type TimelineItem } from './buildTimelineItems';
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
  onAddBreak?: () => void;
  onUpdateBreak?: (stopId: string, patch: { breakTimeStart?: string; breakDurationMinutes?: number }) => void;
  onOptimize?: () => void;
  onDeleteRoute?: () => void;
  deleteRouteLabel?: string;
  isOptimizing?: boolean;
  isSaving?: boolean;
  // Metrics
  metrics?: RouteMetrics | null;
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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIXELS_PER_MINUTE = 2.5;
const MIN_ITEM_HEIGHT = 24;
const MIN_GAP_HEIGHT = 32;

function heightForDuration(minutes: number, minH = MIN_ITEM_HEIGHT): number {
  return Math.max(minH, Math.round(minutes * PIXELS_PER_MINUTE));
}

function formatTime(time: string | null): string {
  if (!time) return '--:--';
  return time.substring(0, 5);
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

function getTotalDuration(metrics: RouteMetrics): number {
  return Math.max(0, Math.round(metrics.travelTimeMin + metrics.serviceTimeMin));
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
}: {
  item: TimelineItem;
  stopIndex: number;
  isSelected: boolean;
  onStopClick: (customerId: string, index: number) => void;
  onRemoveStop?: (stopId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    height: heightForDuration(item.durationMinutes),
    minHeight: MIN_ITEM_HEIGHT,
    opacity: isDragging ? 0.5 : 1,
  };

  const stop = item.stop!;
  const isBreak = item.type === 'break';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isBreak ? styles.breakCard : styles.stopCard} ${isSelected ? styles.selected : ''} ${isDragging ? styles.dragging : ''}`}
      onClick={() => !isBreak && stop.customerId && onStopClick(stop.customerId, stopIndex)}
      {...attributes}
    >
      <div className={styles.dragHandle} {...listeners}>
        <span className={styles.dragIcon}>&#x2801;&#x2801;</span>
      </div>

      <div className={styles.cardContent}>
        <div className={styles.cardHeader}>
          {isBreak ? (
            <span className={styles.cardName}>Pauza</span>
          ) : (
            <>
              <span className={styles.cardOrder}>{stopIndex + 1}</span>
              <span className={styles.cardName}>{stop.customerName ?? 'Neznámý'}</span>
            </>
          )}
          <span className={styles.cardTime}>
            {formatTime(item.startTime)} – {formatTime(item.endTime)}
          </span>
        </div>
        {!isBreak && stop.address && (
          <div className={styles.cardAddress}>{stop.address}</div>
        )}
        {item.durationMinutes > 0 && (
          <div className={styles.cardDuration}>{formatDurationHm(item.durationMinutes)}</div>
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
          title={isBreak ? 'Odstranit pauzu' : 'Odebrat zastávku'}
        >
          &#x2715;
        </button>
      )}
    </div>
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
  onAddBreak,
  onOptimize,
  onDeleteRoute,
  deleteRouteLabel = 'Smazat trasu',
  isOptimizing = false,
  isSaving = false,
  metrics,
  routeStartTime,
  routeEndTime,
  depotDeparture,
  returnToDepotDistanceKm,
  returnToDepotDurationMinutes,
  candidateForInsertion,
  onInsertCandidate,
}: PlanningTimelineProps) {
  const depotName = depot?.name ?? 'Depo';
  const workdayStart = routeStartTime ?? '08:00';
  const workdayEnd = routeEndTime ?? '16:00';

  // Pending DnD warning
  const [pendingReorder, setPendingReorder] = useState<{
    from: number;
    to: number;
    stop: SavedRouteStop;
  } | null>(null);

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

  // Sortable IDs = only stops and breaks
  const sortableIds = useMemo(
    () => stops.map((s) => s.id),
    [stops],
  );

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // DnD handler
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

  if (stops.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Žádné zastávky v této trase.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <div className={styles.timeline}>
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
                  return (
                    <div
                      key={item.id}
                      className={styles.travelSegment}
                      style={{ height: heightForDuration(item.durationMinutes, 8) }}
                    >
                      <div className={styles.travelLine} />
                      {item.durationMinutes > 0 && (
                        <div className={styles.travelInfo}>
                          <span>{formatDurationHm(item.durationMinutes)}</span>
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
                    <div
                      key={item.id}
                      className={`${styles.gapZone} ${gapInfo ? styles.gapZoneActive : ''}`}
                      style={{ height: heightForDuration(item.durationMinutes, MIN_GAP_HEIGHT) }}
                      onClick={() => {
                        if (gapInfo && onInsertCandidate) {
                          onInsertCandidate(item.insertAfterIndex!);
                        }
                      }}
                    >
                      <div className={styles.gapLine} />
                      <div className={styles.gapContent}>
                        <span className={styles.gapDuration}>
                          {formatTime(item.startTime)} – {formatTime(item.endTime)}
                          {' '}({formatDurationHm(item.durationMinutes)})
                        </span>
                        {gapInfo && (
                          <div className={styles.gapCandidate}>
                            <span className={styles.gapCandidateName}>
                              + {candidateForInsertion!.candidateName}
                            </span>
                            {gapInfo.estimatedArrival && (
                              <span className={styles.gapCandidateTime}>
                                ETA {gapInfo.estimatedArrival}
                                {gapInfo.estimatedDeparture && ` – ${gapInfo.estimatedDeparture}`}
                              </span>
                            )}
                            <span className={`${styles.gapCandidateDelta} ${styles[`status_${gapInfo.status}`]}`}>
                              {formatDelta(gapInfo.deltaMin, ' min')} / {formatDelta(gapInfo.deltaKm, ' km')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
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
                    />
                  );
                }

                default:
                  return null;
              }
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Metrics */}
      {metrics && (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{metrics.distanceKm.toFixed(1)} km</span>
            <span className={styles.metricLabel}>Vzdálenost</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{formatDurationHm(getTotalDuration(metrics))}</span>
            <span className={styles.metricLabel}>Celkový čas</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{metrics.loadPercent}%</span>
            <span className={styles.metricLabel}>Zatížení</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        {onOptimize && (
          <button
            type="button"
            className={styles.optimizeButton}
            onClick={onOptimize}
            disabled={isOptimizing || stops.length < 2}
          >
            {isOptimizing ? 'Optimalizuji...' : 'Optimalizovat'}
          </button>
        )}
        {onAddBreak && (
          <button type="button" className={styles.addBreakButton} onClick={onAddBreak}>
            Pauza
          </button>
        )}
        {isSaving && <span className={styles.savingIndicator}>Ukládám...</span>}
        {onDeleteRoute && (
          <button type="button" className={styles.deleteButton} onClick={onDeleteRoute}>
            {deleteRouteLabel}
          </button>
        )}
      </div>

      {/* Scheduled-time warning dialog */}
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
