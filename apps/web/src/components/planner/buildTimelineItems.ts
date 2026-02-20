/**
 * buildTimelineItems — pure function that converts SavedRouteStop[] into a flat
 * sequence of typed timeline items (depot, travel, stop, break, gap).
 *
 * Used by both the compact RouteDetailTimeline and the proportional PlanningTimeline.
 *
 * Algorithm (two-pass):
 *   Pass 1 — build the customer skeleton: depot → [travel → gap? → stop]* → travel-return → depot
 *   Pass 2 — insert breaks into the correct gap based on their array position and breakTimeStart
 *
 * This matches the backend's pending-break model: the crew drives to the next
 * customer's area first, then takes a break within the available gap time.
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
): TimelineItem[] {
  // -------------------------------------------------------------------------
  // Pass 1: build customer skeleton
  // -------------------------------------------------------------------------
  // Walk only customer stops to produce the base timeline. Track where each
  // gap lives so Pass 2 can splice breaks into the right position.
  // -------------------------------------------------------------------------

  const items: TimelineItem[] = [];

  items.push({
    type: 'depot',
    id: 'depot-start',
    startTime: normalise(workdayStart),
    endTime: normalise(workdayStart),
    durationMinutes: 0,
  });

  const customerStops = stops.filter((s) => s.stopType === 'customer');

  if (stops.length === 0) {
    // Empty route: just two depots, no travel-return
    items.push({
      type: 'depot',
      id: 'depot-end',
      startTime: normalise(workdayEnd),
      endTime: normalise(workdayEnd),
      durationMinutes: 0,
    });
    return items;
  }

  let cursor = parseHm(workdayStart);
  let customerStopCount = 0;

  // For each customer stop, record the index in `items` where its preceding
  // gap lives (or would live). Pass 2 uses this to splice breaks in.
  // gapIndexForCustomer[i] = index in `items[]` of the gap before customerStops[i],
  // or -1 if there is no gap.
  const gapIndexForCustomer: number[] = [];
  // gapBoundsForCustomer[i] = { startMin, endMin } of the gap before customerStops[i]
  const gapBoundsForCustomer: Array<{ startMin: number; endMin: number } | null> = [];

  for (let i = 0; i < customerStops.length; i++) {
    const stop = customerStops[i];
    const arrivalMin = stop.estimatedArrival ? parseHm(stop.estimatedArrival) : null;
    const departureMin = stop.estimatedDeparture ? parseHm(stop.estimatedDeparture) : null;
    const travelDuration = stop.durationFromPreviousMinutes ?? 0;
    const travelDistance = stop.distanceFromPreviousKm ?? undefined;

    // Travel segment
    const travelStart = cursor;
    const travelEnd = travelStart + travelDuration;

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

    // Late arrival detection
    const scheduledStartMin = stop.scheduledTimeStart ? parseHm(stop.scheduledTimeStart) : null;
    let lateArrivalMinutes: number | undefined;
    let actualArrivalTime: string | undefined;
    if (scheduledStartMin != null && cursor > scheduledStartMin + GAP_THRESHOLD_MINUTES) {
      lateArrivalMinutes = cursor - scheduledStartMin;
      actualArrivalTime = minutesToHm(cursor);
    }

    // Gap before this customer stop
    if (arrivalMin != null && cursor < arrivalMin - GAP_THRESHOLD_MINUTES) {
      const gapDuration = arrivalMin - cursor;
      gapIndexForCustomer.push(items.length);
      gapBoundsForCustomer.push({ startMin: cursor, endMin: arrivalMin });
      items.push({
        type: 'gap',
        id: `gap-${i}`,
        startTime: minutesToHm(cursor),
        endTime: minutesToHm(arrivalMin),
        durationMinutes: gapDuration,
        insertAfterIndex: customerStopCount - 1,
      });
      cursor = arrivalMin;
    } else {
      gapIndexForCustomer.push(-1);
      gapBoundsForCustomer.push(null);
    }

    // Customer stop
    const stopStart = arrivalMin ?? cursor;
    const stopEnd = departureMin ?? stopStart;
    const stopDuration = Math.max(0, stopEnd - stopStart);
    const scheduledEndMin = stop.scheduledTimeEnd ? parseHm(stop.scheduledTimeEnd) : null;
    const windowDuration =
      scheduledStartMin != null && scheduledEndMin != null
        ? scheduledEndMin - scheduledStartMin
        : null;
    const isFlexibleWindow =
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
      agreedWindowStart: isFlexibleWindow ? normalise(stop.scheduledTimeStart) ?? undefined : undefined,
      agreedWindowEnd: isFlexibleWindow ? normalise(stop.scheduledTimeEnd) ?? undefined : undefined,
      agreedWindowDurationMinutes: isFlexibleWindow ? windowDuration ?? undefined : undefined,
    });

    cursor = stopEnd;
    customerStopCount++;
  }

  // Return travel to depot
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

  // -------------------------------------------------------------------------
  // Pass 2: insert breaks into the correct gap
  // -------------------------------------------------------------------------
  // For each break in the original stops array, determine which slot it belongs
  // to (the gap before the first customer stop whose original array index > break's
  // array index). Then splice the break into that gap, splitting it in two.
  // -------------------------------------------------------------------------

  const breakStops = stops
    .map((s, originalIdx) => ({ stop: s, originalIdx }))
    .filter(({ stop }) => stop.stopType === 'break');

  if (breakStops.length === 0) {
    return items;
  }

  // Build a mapping: originalIdx of each customer stop → its customer-only index
  const customerOriginalIndices = stops
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.stopType === 'customer')
    .map(({ idx }) => idx);

  // Offset tracker: as we splice items into the array, indices shift.
  // We process breaks in order of their original array position so splices
  // accumulate predictably.
  let insertionOffset = 0;

  for (const { stop: breakStop, originalIdx } of breakStops) {
    // Find which customer stop slot this break belongs to:
    // the first customer whose original index is AFTER the break's original index.
    const nextCustomerLocalIdx = customerOriginalIndices.findIndex(
      (custOrigIdx) => custOrigIdx > originalIdx,
    );

    const breakDuration =
      breakStop.breakDurationMinutes ??
      (() => {
        const dep = breakStop.estimatedDeparture ? parseHm(breakStop.estimatedDeparture) : null;
        const arr = breakStop.estimatedArrival ? parseHm(breakStop.estimatedArrival) : null;
        return dep != null && arr != null ? Math.max(0, dep - arr) : 30;
      })();

    // Determine break start time from breakTimeStart or estimatedArrival
    const breakTimeStartMin =
      breakStop.breakTimeStart
        ? parseHm(breakStop.breakTimeStart)
        : breakStop.estimatedArrival
          ? parseHm(breakStop.estimatedArrival)
          : null;

    if (nextCustomerLocalIdx === -1) {
      // Break is after all customers — place it just before travel-return.
      // Find travel-return item.
      const returnTravelIdx = items.findIndex((it) => it.id === 'travel-return') + insertionOffset;
      const prevItem = items[returnTravelIdx - 1];
      const breakStart =
        breakTimeStartMin ??
        (prevItem?.endTime ? parseHm(prevItem.endTime) : parseHm(workdayStart));
      const breakEnd = breakStart + breakDuration;

      const breakItem: TimelineItem = {
        type: 'break',
        id: breakStop.id,
        startTime: minutesToHm(breakStart),
        endTime: minutesToHm(breakEnd),
        durationMinutes: breakDuration,
        stop: breakStop,
      };
      items.splice(returnTravelIdx, 0, breakItem);
      insertionOffset++;
      continue;
    }

    // There is a next customer. Get the gap info for that customer.
    const gapIdx = gapIndexForCustomer[nextCustomerLocalIdx];
    const gapBounds = gapBoundsForCustomer[nextCustomerLocalIdx];

    if (gapIdx === -1 || gapBounds === null) {
      // No gap exists before the next customer (travel fills the slot entirely).
      // Insert the break just before the next customer stop anyway — it will
      // overflow and cause a late arrival, which is correct behaviour.
      const customerItemIdx = items.findIndex(
        (it) => it.type === 'stop' && it.stop?.id === customerStops[nextCustomerLocalIdx]?.id,
      ) + insertionOffset;

      const breakStart = breakTimeStartMin ?? gapBounds?.startMin ?? parseHm(workdayStart);
      const breakEnd = breakStart + breakDuration;

      const breakItem: TimelineItem = {
        type: 'break',
        id: breakStop.id,
        startTime: minutesToHm(breakStart),
        endTime: minutesToHm(breakEnd),
        durationMinutes: breakDuration,
        stop: breakStop,
      };
      items.splice(customerItemIdx, 0, breakItem);
      insertionOffset++;
      continue;
    }

    // There is a gap. Determine break position within it.
    const gapStart = gapBounds.startMin;
    const gapEnd = gapBounds.endMin;
    const insertAfterIndex = (items[gapIdx + insertionOffset] as TimelineItem).insertAfterIndex;

    // Clamp break start to gap start (cannot start before gap opens).
    const rawBreakStart = breakTimeStartMin ?? gapStart;
    const breakStart = Math.max(gapStart, rawBreakStart);
    const breakEnd = breakStart + breakDuration;

    // Split the gap into [gap_before] → break → [gap_after]
    const gapBeforeDuration = breakStart - gapStart;
    const gapAfterStart = breakEnd;
    const gapAfterDuration = gapEnd - gapAfterStart;

    const actualGapIdx = gapIdx + insertionOffset;

    // Items to replace the single gap with
    const replacements: TimelineItem[] = [];

    if (gapBeforeDuration > GAP_THRESHOLD_MINUTES) {
      replacements.push({
        type: 'gap',
        id: `gap-before-${breakStop.id}`,
        startTime: minutesToHm(gapStart),
        endTime: minutesToHm(breakStart),
        durationMinutes: gapBeforeDuration,
        insertAfterIndex,
      });
    }

    replacements.push({
      type: 'break',
      id: breakStop.id,
      startTime: minutesToHm(breakStart),
      endTime: minutesToHm(breakEnd),
      durationMinutes: breakDuration,
      stop: breakStop,
    });

    if (gapAfterDuration > GAP_THRESHOLD_MINUTES) {
      replacements.push({
        type: 'gap',
        id: `gap-after-${breakStop.id}`,
        startTime: minutesToHm(gapAfterStart),
        endTime: minutesToHm(gapEnd),
        durationMinutes: gapAfterDuration,
        insertAfterIndex,
      });
    }

    // Replace the original gap with the split items
    items.splice(actualGapIdx, 1, ...replacements);
    insertionOffset += replacements.length - 1;
  }

  return items;
}
