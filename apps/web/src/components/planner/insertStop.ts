import type { SavedRouteStop } from '../../services/routeService';

/**
 * Parse a time string "HH:MM" or "HH:MM:SS" into total minutes from midnight.
 * Returns null if the string is falsy or unparseable.
 */
function parseTimeMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const parts = time.split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

/**
 * Find the correct chronological insertion index for a new customer stop
 * based on `scheduledTimeStart`.
 *
 * Only customer stops are compared; break stops are ignored for ordering
 * purposes (they get repositioned separately).
 *
 * @returns Zero-based index into `stops` where the new stop should be placed.
 */
export function findChronologicalPosition(
  stops: SavedRouteStop[],
  newStop: SavedRouteStop,
): number {
  const newMin = parseTimeMinutes(newStop.scheduledTimeStart);
  if (newMin === null) return stops.length; // No scheduled time → append

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    // Skip non-customer stops (breaks) – they'll be repositioned
    if (s.stopType !== 'customer') continue;

    const sMin = parseTimeMinutes(s.scheduledTimeStart);
    if (sMin !== null && newMin < sMin) {
      return i; // Insert before this stop
    }
  }
  return stops.length; // Append after all existing stops
}

/**
 * Insert a new stop at a given position and renumber all stops.
 *
 * @param stops      Current ordered list of stops.
 * @param newStop    The stop to insert (stopOrder will be overwritten).
 * @param insertAt   Zero-based index where the new stop will be placed.
 *                   Clamped to [0, stops.length].
 * @returns          New array with updated stopOrder values (1-indexed).
 */
export function insertStopAtPosition(
  stops: SavedRouteStop[],
  newStop: SavedRouteStop,
  insertAt: number,
): SavedRouteStop[] {
  const clampedIdx = Math.max(0, Math.min(insertAt, stops.length));

  const result = [
    ...stops.slice(0, clampedIdx),
    newStop,
    ...stops.slice(clampedIdx),
  ];

  // Renumber 1-indexed
  return result.map((s, i) => ({ ...s, stopOrder: i + 1 }));
}
