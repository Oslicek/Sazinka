/**
 * buildTimelineItems — pure function that converts SavedRouteStop[] into a flat
 * sequence of typed timeline items (depot, travel, stop, break, gap).
 *
 * Used by both the compact RouteDetailTimeline and the proportional PlanningTimeline.
 *
 * Walks all stops in array order (customers and breaks alike). Breaks are
 * rendered inline at their array position, using breakDurationMinutes for
 * height. Gaps appear wherever the cursor is ahead of the next stop's
 * estimated arrival.
 */

import type { SavedRouteStop } from '../../services/routeService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineItemType = 'depot' | 'travel' | 'stop' | 'break' | 'gap';

export interface TimelineItem {
  type: TimelineItemType;
  /** Unique identifier (for React keys and DnD) */
  id: string;
  /** HH:MM */
  startTime: string | null;
  /** HH:MM */
  endTime: string | null;
  /** Duration in minutes (used for proportional heights) */
  durationMinutes: number;
  /** The original route stop (for 'stop' and 'break' types) */
  stop?: SavedRouteStop;
  /** Travel distance in km (for 'travel' type) */
  distanceKm?: number;
  /** For 'gap' type: the stop index this gap follows (-1 = before first stop) */
  insertAfterIndex?: number;
  /**
   * For 'travel' type: the ID of the destination stop.
   * Used to identify which stop's travel duration to override.
   */
  destinationStopId?: string;
  /**
   * For 'travel' type: the manual override for travel duration (minutes).
   * Mirrors SavedRouteStop.overrideTravelDurationMinutes for the destination stop.
   */
  overrideTravelDurationMinutes?: number | null;
  /**
   * Minutes by which the actual arrival is later than the scheduled start.
   * Only set when the crew cannot physically arrive on time due to travel
   * from the previous stop. Signals that the agreed time slot must be
   * renegotiated with the customer.
   */
  lateArrivalMinutes?: number;
  /** The actual arrival time (HH:MM) when different from scheduled start. */
  actualArrivalTime?: string;
  /** Full agreed window start for flexible stops (HH:MM). */
  agreedWindowStart?: string;
  /** Full agreed window end for flexible stops (HH:MM). */
  agreedWindowEnd?: string;
  /** Full agreed window duration in minutes for flexible stops. */
  agreedWindowDurationMinutes?: number;
  /**
   * True when a customer stop was placed via Quick Gap Placement (no recalc).
   * The scheduled times are provisional — the customer needs to be re-contacted.
   */
  needsReschedule?: boolean;
}

export interface ReturnToDepotInfo {
  distanceKm: number;
  durationMinutes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM" or "HH:MM:SS" to total minutes from midnight. */
function parseHm(time: string): number {
  const parts = time.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** Format total minutes to "HH:MM". */
function minutesToHm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalise a time string to "HH:MM" (strip seconds). */
function normalise(time: string | null): string | null {
  if (!time) return null;
  return time.substring(0, 5);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const GAP_THRESHOLD_MINUTES = 1;

export function buildTimelineItems(
  stops: SavedRouteStop[],
  workdayStart: string,
  workdayEnd: string,
  returnToDepot?: ReturnToDepotInfo,
  depotDeparture?: string | null,
): TimelineItem[] {
  const items: TimelineItem[] = [];

  const effectiveStart = depotDeparture ?? workdayStart;

  items.push({
    type: 'depot',
    id: 'depot-start',
    startTime: normalise(effectiveStart),
    endTime: normalise(effectiveStart),
    durationMinutes: 0,
  });

  if (stops.length === 0) {
    items.push({
      type: 'depot',
      id: 'depot-end',
      startTime: normalise(workdayEnd),
      endTime: normalise(workdayEnd),
      durationMinutes: 0,
    });
    return items;
  }

  let cursor = parseHm(effectiveStart);
  // Customer-only counter for gap insertAfterIndex (backend uses customer-only indices)
  let customerStopCount = 0;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const isBreak = stop.stopType === 'break';
    const arrivalMin = stop.estimatedArrival ? parseHm(stop.estimatedArrival) : null;
    const departureMin = stop.estimatedDeparture ? parseHm(stop.estimatedDeparture) : null;
    const travelDuration = stop.durationFromPreviousMinutes ?? 0;
    const travelDistance = stop.distanceFromPreviousKm ?? undefined;

    // --- Travel segment ---
    const travelStart = cursor;
    const travelEnd = travelStart + travelDuration;

    if (!isBreak) {
      // Only emit travel for customer stops; breaks don't have independent travel
      items.push({
        type: 'travel',
        id: `travel-${i}`,
        startTime: minutesToHm(travelStart),
        endTime: minutesToHm(travelEnd),
        durationMinutes: travelDuration,
        distanceKm: travelDistance,
        destinationStopId: stop.id,
        overrideTravelDurationMinutes: stop.overrideTravelDurationMinutes ?? null,
      });
      cursor = travelEnd;
    }

    // --- Late arrival detection (customer stops only) ---
    const scheduledStartMin = stop.scheduledTimeStart ? parseHm(stop.scheduledTimeStart) : null;
    let lateArrivalMinutes: number | undefined;
    let actualArrivalTime: string | undefined;
    if (!isBreak && scheduledStartMin != null && cursor > scheduledStartMin + GAP_THRESHOLD_MINUTES) {
      lateArrivalMinutes = cursor - scheduledStartMin;
      actualArrivalTime = minutesToHm(cursor);
    }

    // --- Gap before this stop ---
    // For breaks: only use estimatedArrival for gap if it's ahead of the cursor.
    // Stale break times (before cursor) should not create gaps.
    const effectiveArrival = isBreak
      ? (arrivalMin != null && arrivalMin > cursor ? arrivalMin : null)
      : arrivalMin;

    if (effectiveArrival != null && cursor < effectiveArrival - GAP_THRESHOLD_MINUTES) {
      const gapDuration = effectiveArrival - cursor;
      const isBeforeCustomerStop = !isBreak;
      items.push({
        type: 'gap',
        id: `gap-${i}`,
        startTime: minutesToHm(cursor),
        endTime: minutesToHm(effectiveArrival),
        durationMinutes: gapDuration,
        insertAfterIndex: isBeforeCustomerStop ? customerStopCount - 1 : undefined,
      });
      cursor = effectiveArrival;
    }

    // --- The stop or break itself ---
    if (isBreak) {
      // For break start: prefer breakTimeStart or estimatedArrival, but never
      // go backwards before the cursor (stale times from before a reorder).
      const rawBreakStart = stop.breakTimeStart
        ? parseHm(stop.breakTimeStart)
        : arrivalMin;
      const breakStart = rawBreakStart != null && rawBreakStart >= cursor
        ? rawBreakStart
        : cursor;
      const breakDur = stop.breakDurationMinutes
        ?? (departureMin != null && arrivalMin != null ? Math.max(0, departureMin - arrivalMin) : 30);
      const breakEnd = breakStart + breakDur;
      const breakDuration = Math.max(0, breakEnd - breakStart);

      items.push({
        type: 'break',
        id: stop.id,
        startTime: minutesToHm(breakStart),
        endTime: minutesToHm(breakEnd),
        durationMinutes: breakDuration,
        stop,
      });
      cursor = breakEnd;
    } else {
      // Customer stop
      const stopStart = arrivalMin ?? cursor;
      const stopEnd = departureMin ?? stopStart;
      const stopDuration = Math.max(0, stopEnd - stopStart);
      const scheduledEndMin = stop.scheduledTimeEnd ? parseHm(stop.scheduledTimeEnd) : null;
      const windowDuration =
        scheduledStartMin != null && scheduledEndMin != null
          ? scheduledEndMin - scheduledStartMin
          : null;
      const hasAgreedWindow = scheduledStartMin != null && scheduledEndMin != null;
      const isFlexibleWindow =
        hasAgreedWindow &&
        stop.serviceDurationMinutes != null &&
        stop.serviceDurationMinutes > 0 &&
        windowDuration != null &&
        windowDuration > 0 &&
        stop.serviceDurationMinutes < windowDuration;

      items.push({
        type: 'stop',
        id: stop.id,
        startTime: minutesToHm(stopStart),
        endTime: minutesToHm(stopEnd),
        durationMinutes: stopDuration,
        stop,
        lateArrivalMinutes,
        actualArrivalTime,
        agreedWindowStart: hasAgreedWindow ? normalise(stop.scheduledTimeStart) ?? undefined : undefined,
        agreedWindowEnd: hasAgreedWindow ? normalise(stop.scheduledTimeEnd) ?? undefined : undefined,
        agreedWindowDurationMinutes: isFlexibleWindow ? windowDuration ?? undefined : undefined,
        needsReschedule: stop.needsReschedule ?? undefined,
      });
      cursor = stopEnd;
      customerStopCount++;
    }
  }

  // --- Return travel to depot ---
  if (returnToDepot) {
    const rtStart = cursor;
    const rtEnd = cursor + returnToDepot.durationMinutes;
    items.push({
      type: 'travel',
      id: 'travel-return',
      startTime: minutesToHm(rtStart),
      endTime: minutesToHm(rtEnd),
      durationMinutes: returnToDepot.durationMinutes,
      distanceKm: returnToDepot.distanceKm,
    });
    cursor = rtEnd;
  } else {
    items.push({
      type: 'travel',
      id: 'travel-return',
      startTime: minutesToHm(cursor),
      endTime: null,
      durationMinutes: 0,
    });
  }

  items.push({
    type: 'depot',
    id: 'depot-end',
    startTime: returnToDepot ? minutesToHm(cursor) : normalise(workdayEnd),
    endTime: null,
    durationMinutes: 0,
  });

  return items;
}
