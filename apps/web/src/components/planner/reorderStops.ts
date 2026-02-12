/**
 * reorderStops — pure functions for drag-and-drop stop reordering.
 *
 * Used by both compact RouteDetailTimeline and PlanningTimeline.
 */

import type { SavedRouteStop } from '../../services/routeService';

/**
 * Reorder stops by moving the element at `fromIndex` to `toIndex`.
 * Returns a new array with `stopOrder` values reassigned (1-indexed).
 * Does not mutate the original array.
 */
export function reorderStops(
  stops: SavedRouteStop[],
  fromIndex: number,
  toIndex: number,
): SavedRouteStop[] {
  const copy = [...stops];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy.map((s, i) => ({ ...s, stopOrder: i + 1 }));
}

/**
 * Check if moving a stop requires a scheduled-time warning.
 * Returns the stop that has an agreed time, or null if no warning is needed.
 */
export function needsScheduledTimeWarning(
  stops: SavedRouteStop[],
  fromIndex: number,
  toIndex: number,
): SavedRouteStop | null {
  if (fromIndex === toIndex) return null;
  const stop = stops[fromIndex];
  if (!stop) return null;
  if (stop.scheduledTimeStart) return stop;
  return null;
}
