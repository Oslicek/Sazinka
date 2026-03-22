/**
 * Pure helpers extracted from PlanningInbox for unit testing and reuse.
 * Behavior must match the previous inline useMemo implementations.
 */
import type { SavedRouteStop } from '../services/routeService';
import type { SelectedCandidate } from '../components/planner/RouteMapPanel';

/** Candidate row shape needed for batch map pins */
export interface CandidateForMapSelection {
  customerId: string;
  customerName: string;
  customerLat: number | null;
  customerLng: number | null;
}

/** Stable key: only changes when stop locations change (not ETAs) */
export function buildGeometryKey(routeStops: SavedRouteStop[]): string {
  return routeStops
    .filter((s) => s.stopType !== 'break' && s.customerLat != null && s.customerLng != null)
    .map((s) => `${s.customerLat},${s.customerLng}`)
    .join('|');
}

/** Stable key: stop IDs + locations (not ETAs) */
export function buildRouteShapeKey(routeStops: SavedRouteStop[]): string {
  return routeStops
    .filter((s) => s.stopType === 'customer' && s.customerLat && s.customerLng)
    .map((s) => `${s.id}:${s.customerLat},${s.customerLng}`)
    .join('|');
}

export function buildInRouteIds(routeStops: SavedRouteStop[]): Set<string | null> {
  return new Set(routeStops.map((s) => s.customerId));
}

export function computeActualRouteEnd(
  routeStops: SavedRouteStop[],
  returnToDepotLeg: { durationMinutes?: number | null } | null | undefined,
  routeEndTime: string | null,
): string | null {
  if (routeStops.length === 0) return routeEndTime;
  const lastStop = routeStops[routeStops.length - 1];
  const lastDeparture = lastStop.estimatedDeparture ?? lastStop.estimatedArrival;
  if (!lastDeparture) return routeEndTime;
  const returnMin = returnToDepotLeg?.durationMinutes ?? 0;
  if (returnMin <= 0) return lastDeparture.slice(0, 5);
  const [hh, mm] = lastDeparture.slice(0, 5).split(':').map(Number);
  const totalMin = hh * 60 + mm + Math.round(returnMin);
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

export function buildSelectedCandidatesForMap(
  selectedIds: Set<string>,
  candidates: CandidateForMapSelection[],
  inRouteIds: Set<string | null>,
): SelectedCandidate[] {
  if (selectedIds.size === 0) return [];
  return Array.from(selectedIds)
    .map((id) => candidates.find((c) => c.customerId === id))
    .filter((c): c is CandidateForMapSelection => c != null)
    .filter((c) => !!c.customerLat && !!c.customerLng)
    .filter((c) => !inRouteIds.has(c.customerId))
    .map((c) => ({
      id: c.customerId,
      name: c.customerName,
      coordinates: { lat: c.customerLat!, lng: c.customerLng! },
    }));
}
