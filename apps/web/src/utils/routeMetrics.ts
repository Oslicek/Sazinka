import type { SavedRouteStop } from '../services/routeService';
import type { RouteMetrics } from '../components/planner/CapacityMetrics';

export interface ReturnToDepotLeg {
  distanceKm: number | null;
  durationMinutes: number | null;
}

function parseHm(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function calculateMetrics(
  stops: SavedRouteStop[],
  routeTotals?: { distanceKm?: number | null; durationMinutes?: number | null },
  returnToDepotLeg?: ReturnToDepotLeg | null,
): RouteMetrics | null {
  if (stops.length === 0) return null;

  const returnDistanceKm = returnToDepotLeg?.distanceKm ?? 0;
  const returnDurationMin = returnToDepotLeg?.durationMinutes ?? 0;

  const summedDistanceKm =
    stops.reduce((sum, stop) => sum + (stop.distanceFromPreviousKm ?? 0), 0) + returnDistanceKm;
  const distanceKm =
    summedDistanceKm > 0
      ? summedDistanceKm
      : Math.max(0, routeTotals?.distanceKm ?? 0);
  const rawTravelTimeMin =
    stops.reduce((sum, stop) => sum + (stop.durationFromPreviousMinutes ?? 0), 0) + returnDurationMin;
  const breakMin = stops
    .filter((s) => s.stopType === 'break')
    .reduce((sum, s) => sum + (s.breakDurationMinutes ?? 0), 0);
  const customerServiceMin = stops.filter((s) => s.stopType === 'customer').length * 30;
  const nonTravelMin = customerServiceMin + breakMin;

  const firstArrival = parseHm(stops[0].estimatedArrival);
  const lastDeparture = parseHm(stops[stops.length - 1].estimatedDeparture);
  let totalMin = 0;

  // Prefer persisted route totals when available so Planner matches Inbox
  // for the same saved route.
  if ((routeTotals?.durationMinutes ?? 0) > 0) {
    totalMin = routeTotals?.durationMinutes ?? 0;
  } else if (firstArrival != null && lastDeparture != null) {
    totalMin = lastDeparture - firstArrival;
    if (totalMin < 0) totalMin += 24 * 60;
  } else {
    totalMin = rawTravelTimeMin + nonTravelMin;
  }

  // Saved/optimized routes can miss per-segment durations in UI model.
  // In that case estimate driving as total minus non-driving blocks.
  const travelTimeMin = rawTravelTimeMin > 0
    ? rawTravelTimeMin
    : Math.max(0, totalMin - nonTravelMin);
  const serviceTimeMin = Math.max(0, totalMin - travelTimeMin);
  const workingDayMin = 9 * 60;

  return {
    distanceKm,
    travelTimeMin: Math.max(0, Math.round(travelTimeMin)),
    serviceTimeMin: Math.max(0, Math.round(serviceTimeMin)),
    loadPercent: Math.round((totalMin / workingDayMin) * 100),
    slackMin: Math.max(0, workingDayMin - totalMin),
    stopCount: stops.length,
  };
}
