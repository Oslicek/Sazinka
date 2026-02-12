/**
 * buildTimelineItems — pure function that converts SavedRouteStop[] into a flat
 * sequence of typed timeline items (depot, travel, stop, break, gap).
 *
 * Used by both the compact RouteDetailTimeline and the proportional PlanningTimeline.
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
  const items: TimelineItem[] = [];

  // Always start from workday start — gaps before the first scheduled stop
  // represent available time where another candidate could be inserted.
  items.push({
    type: 'depot',
    id: 'depot-start',
    startTime: normalise(workdayStart),
    endTime: normalise(workdayStart),
    durationMinutes: 0,
  });

  if (stops.length === 0) {
    // Empty route: just two depots
    items.push({
      type: 'depot',
      id: 'depot-end',
      startTime: normalise(workdayEnd),
      endTime: normalise(workdayEnd),
      durationMinutes: 0,
    });
    return items;
  }

  // Track the "current time cursor" as we walk through stops
  let cursor = parseHm(workdayStart);
  // Customer-only stop counter for matching backend insertion indices
  // (the backend receives only customer stops, so its insertAfterIndex
  // is in customer-only space, not the full array including breaks).
  let customerStopCount = 0;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const arrivalMin = stop.estimatedArrival ? parseHm(stop.estimatedArrival) : null;
    const departureMin = stop.estimatedDeparture ? parseHm(stop.estimatedDeparture) : null;
    const travelDuration = stop.durationFromPreviousMinutes ?? 0;
    const travelDistance = stop.distanceFromPreviousKm ?? undefined;

    // --- Travel segment from cursor to this stop ---
    const travelStart = cursor;
    const travelEnd = travelStart + travelDuration;

    items.push({
      type: 'travel',
      id: `travel-${i}`,
      startTime: minutesToHm(travelStart),
      endTime: minutesToHm(travelEnd),
      durationMinutes: travelDuration,
      distanceKm: travelDistance,
    });

    cursor = travelEnd;

    // --- Gap: if travel end < stop arrival, there's free time ---
    if (arrivalMin != null && cursor < arrivalMin - GAP_THRESHOLD_MINUTES) {
      const gapDuration = arrivalMin - cursor;
      // Only assign insertAfterIndex to gaps immediately before a customer stop.
      // This avoids duplicate previews when a break creates an extra gap
      // between two customer stops (e.g. gap before break + gap after break).
      const isBeforeCustomerStop = stop.stopType === 'customer';
      items.push({
        type: 'gap',
        id: `gap-${i}`,
        startTime: minutesToHm(cursor),
        endTime: minutesToHm(arrivalMin),
        durationMinutes: gapDuration,
        insertAfterIndex: isBeforeCustomerStop ? customerStopCount - 1 : undefined,
      });
      cursor = arrivalMin;
    }

    // --- Stop or break ---
    const isBreak = stop.stopType === 'break';
    const stopStart = arrivalMin ?? cursor;
    // For breaks without estimated departure, use breakDurationMinutes
    const stopEnd = departureMin
      ?? (isBreak && stop.breakDurationMinutes ? stopStart + stop.breakDurationMinutes : stopStart);
    const stopDuration = Math.max(0, stopEnd - stopStart);

    items.push({
      type: isBreak ? 'break' : 'stop',
      id: stop.id,
      startTime: minutesToHm(stopStart),
      endTime: minutesToHm(stopEnd),
      durationMinutes: stopDuration,
      stop,
    });

    cursor = stopEnd;

    // Increment customer counter AFTER processing the stop
    if (stop.stopType === 'customer') {
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
    // Unknown return travel
    items.push({
      type: 'travel',
      id: 'travel-return',
      startTime: minutesToHm(cursor),
      endTime: null,
      durationMinutes: 0,
    });
  }

  // End depot
  items.push({
    type: 'depot',
    id: 'depot-end',
    startTime: returnToDepot ? minutesToHm(cursor) : normalise(workdayEnd),
    endTime: null,
    durationMinutes: 0,
  });

  return items;
}
