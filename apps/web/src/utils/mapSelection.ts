/**
 * Pure helpers for map sub-selection operations.
 * Used by both PlanningInbox (main window) and panels/RouteMapPanel (detached window).
 */

export function toggleMapSelectedId(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter(x => x !== id)
    : [...current, id];
}

export function mergeMapSelectedIds(current: string[], incoming: string[]): string[] {
  const set = new Set(current);
  for (const id of incoming) set.add(id);
  return [...set];
}
