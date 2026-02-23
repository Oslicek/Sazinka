/**
 * RouteDetailTimeline - Vertical timeline of a route with depot, stops and segments
 *
 * Shows depot → segment → stop → segment → stop → ... → depot.
 * Clicking a stop or segment highlights it on the map.
 */

import type { ReactNode } from 'react';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, AlertTriangle } from 'lucide-react';
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
import { resolveBackendMessage } from '@/i18n/resolveBackendMessage';
import { TimeInput } from '../common/TimeInput';
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
  onUpdateTravelDuration?: (stopId: string, minutes: number) => void;
  onResetTravelDuration?: (stopId: string) => void;
  onUpdateServiceDuration?: (stopId: string, minutes: number) => void;
  onResetServiceDuration?: (stopId: string) => void;
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
  hasScheduledTime: boolean,
  t: (key: string) => string
): { label: string; className: string } {
  // If has scheduled time but status is not confirmed, treat as scheduled
  if (hasScheduledTime && revisionStatus !== 'confirmed' && revisionStatus !== 'completed' && revisionStatus !== 'cancelled') {
    return { label: t('timeline_status_scheduled'), className: styles.badgeScheduled };
  }
  
  switch (revisionStatus) {
    case 'confirmed':
      return { label: t('timeline_status_confirmed'), className: styles.badgeConfirmed };
    case 'scheduled':
      return { label: t('timeline_status_scheduled'), className: styles.badgeScheduled };
    case 'completed':
      return { label: t('timeline_status_completed'), className: styles.badgeCompleted };
    case 'cancelled':
      return { label: t('timeline_status_cancelled'), className: styles.badgeCancelled };
    case 'upcoming':
    default:
      return { label: t('timeline_status_pending'), className: styles.badgePending };
  }
}

function calculateTimeDifference(time1: string | null, time2: string | null): number | null {
  if (!time1 || !time2) return null;
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  return Math.abs((h1 * 60 + m1) - (h2 * 60 + m2));
}

function getWarningLabel(warningType: string, t: (key: string) => string): string {
  switch (warningType) {
    case 'LATE_ARRIVAL':
      return t('timeline_warning_late');
    case 'INSUFFICIENT_BUFFER':
      return t('timeline_warning_buffer');
    case 'TIME_WINDOW':
      return t('timeline_warning_window');
    default:
      return warningType;
  }
}

function getWarningIcon(warningType: string): ReactNode {
  switch (warningType) {
    case 'LATE_ARRIVAL':
      return <AlertTriangle size={14} />;
    case 'INSUFFICIENT_BUFFER':
      return <AlertTriangle size={14} />;
    default:
      return <AlertTriangle size={14} />;
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
  onUpdateTravelDuration,
  onResetTravelDuration,
  onUpdateServiceDuration,
  onResetServiceDuration,
  isSaving = false,
  warnings = [],
  returnToDepotDistanceKm = null,
  returnToDepotDurationMinutes = null,
}: RouteDetailTimelineProps) {
  const { t } = useTranslation('planner');
  const depotName = depot?.name ?? t('timeline_depot');

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
        <div className={styles.empty}>{t('timeline_empty')}</div>
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
        <MapPin size={16} className={styles.depotIcon} />
        <span className={styles.depotName}>{depotName}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      {stops.map((stop, index) => {
        const isBreak = stop.stopType === 'break';
        const hasScheduledTime = !!(stop.scheduledTimeStart && stop.scheduledTimeEnd);
        const badge = isBreak 
          ? { label: t('timeline_break'), className: styles.badgeBreak }
          : stop.status === 'unassigned'
            ? { label: t('timeline_unassigned'), className: styles.badgeUnassigned }
            : getStatusBadge(stop.revisionStatus, hasScheduledTime, t);
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
                {onUpdateTravelDuration && stop.stopType !== 'break' ? (
                  <span className={styles.inlineEditGroup}>
                    <input
                      type="number"
                      className={styles.inlineInput}
                      value={stop.overrideTravelDurationMinutes ?? segmentDuration ?? 0}
                      min={0}
                      max={999}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const val = Math.max(0, parseInt(e.target.value || '0', 10));
                        onUpdateTravelDuration(stop.id, val);
                      }}
                    />
                    <span className={styles.inlineUnit}>min</span>
                    {stop.overrideTravelDurationMinutes != null && onResetTravelDuration && (
                      <button
                        type="button"
                        className={styles.overrideReset}
                        onClick={(e) => { e.stopPropagation(); onResetTravelDuration(stop.id); }}
                        title={t('override_reset_tooltip')}
                      ><AlertTriangle size={14} /></button>
                    )}
                  </span>
                ) : (
                  <span className={styles.segmentDuration}>{formatDurationHm(segmentDuration)}</span>
                )}
              </div>
            </div>

            {/* Stop card (or break card) */}
            {isBreak ? (
              <div className={`${styles.breakCard} ${isSelected ? styles.stopCardSelected : ''}`}>
                <div className={styles.breakIcon}>☕</div>
                <div className={styles.stopContent}>
                  <div className={styles.stopHeader}>
                    <span className={styles.stopName}>{t('timeline_break')}</span>
                    <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                  </div>
                  <div className={styles.breakMetaRow}>
                    <div className={styles.breakField}>
                      <span className={styles.breakFieldLabel}>{t('timeline_break_start')}</span>
                      <div className={styles.stopTime}>
                        {onUpdateBreak ? (
                          <TimeInput
                            value={stop.breakTimeStart?.substring(0, 5) || '12:00'}
                            onChange={(v) => onUpdateBreak(stop.id, { breakTimeStart: v })}
                          />
                        ) : (
                          <span>{formatTime(stop.breakTimeStart || null)}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.breakField}>
                      <span className={styles.breakFieldLabel}>{t('timeline_break_duration')}</span>
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
                    title={t('timeline_remove_break')}
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
                      <span className={styles.timeLabel}>{t('timeline_time_agreed')}</span>
                      <div className={styles.stopTime}>
                        <span>{formatTime(stop.scheduledTimeStart)}</span>
                        <span className={styles.timeSeparator}>–</span>
                        <span>{formatTime(stop.scheduledTimeEnd)}</span>
                      </div>
                      {hasSignificantDiff && <span title={t('timeline_time_diff_warning')}><AlertTriangle size={14} className={styles.warningIcon} /></span>}
                    </div>
                    {(stop.estimatedArrival || stop.estimatedDeparture) && (
                      <div className={styles.timeRow}>
                        <span className={styles.timeLabel}>{t('timeline_time_calculated')}</span>
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
                    <span className={styles.timeLabel}>{t('timeline_time_calculated')}</span>
                    <div className={styles.stopTime}>
                      <span>{formatTime(stop.estimatedArrival)}</span>
                      <span className={styles.timeSeparator}>–</span>
                      <span>{formatTime(stop.estimatedDeparture)}</span>
                    </div>
                  </div>
                )}
                
                  <div className={styles.stopAddress}>{stop.address}</div>

                  {/* Service duration (inline editable) */}
                  <div className={styles.timeRow}>
                    <span className={styles.timeLabel}>{t('service_duration_label')}</span>
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
                          ><AlertTriangle size={14} /></button>
                        )}
                      </span>
                    ) : (
                      <span>{stop.serviceDurationMinutes ?? 30} min</span>
                    )}
                  </div>
                  
                  {/* Per-stop warnings (LATE_ARRIVAL, INSUFFICIENT_BUFFER) */}
                  {warningsByStop.has(index) && (
                    <div className={styles.stopWarnings}>
                      {warningsByStop.get(index)!.map((w, wi) => (
                        <div
                          key={wi}
                          className={`${styles.stopWarning} ${w.warningType === 'LATE_ARRIVAL' ? styles.stopWarningDanger : styles.stopWarningCaution}`}
                          title={resolveBackendMessage(w.message)}
                        >
                          <span className={styles.stopWarningIcon}>{getWarningIcon(w.warningType)}</span>
                          <span>{getWarningLabel(w.warningType, t)}</span>
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
                    title={t('timeline_remove_stop')}
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
        <MapPin size={16} className={styles.depotIcon} />
        <span className={styles.depotName}>{depotName}</span>
      </div>

      {isSaving && (
        <div className={styles.savingIndicator}>⟳ {t('timeline_saving')}</div>
      )}

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
