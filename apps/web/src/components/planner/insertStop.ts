import type { SavedRouteStop } from '../../services/routeService';

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
