/**
 * BUG-5 regression tests: calculateMetrics must include the return-to-depot leg.
 */
import { describe, it, expect } from 'vitest';
import { calculateMetrics } from '../../utils/routeMetrics';
import type { SavedRouteStop } from '../../services/routeService';

function makeStop(overrides: Partial<SavedRouteStop> = {}): SavedRouteStop {
  return {
    id: 'stop-1',
    routeId: 'r1',
    revisionId: null,
    stopOrder: 1,
    estimatedArrival: null,
    estimatedDeparture: null,
    distanceFromPreviousKm: null,
    durationFromPreviousMinutes: null,
    status: 'pending',
    stopType: 'customer',
    customerId: 'c1',
    customerName: 'Test',
    address: null,
    customerLat: 49.0,
    customerLng: 16.0,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
    ...overrides,
  };
}

describe('calculateMetrics — BUG-5: return-to-depot leg', () => {
  const stopsWithDistances: SavedRouteStop[] = [
    makeStop({ id: 's1', stopOrder: 1, distanceFromPreviousKm: 10, durationFromPreviousMinutes: 12 }),
    makeStop({ id: 's2', stopOrder: 2, distanceFromPreviousKm: 8, durationFromPreviousMinutes: 10 }),
    makeStop({ id: 's3', stopOrder: 3, distanceFromPreviousKm: 5, durationFromPreviousMinutes: 6 }),
  ];

  it('includes return-to-depot distance in total', () => {
    const returnLeg = { distanceKm: 12, durationMinutes: 15 };
    const m = calculateMetrics(stopsWithDistances, undefined, returnLeg);
    // Per-stop sum: 10 + 8 + 5 = 23 km. Return: 12 km. Total: 35 km.
    expect(m).not.toBeNull();
    expect(m!.distanceKm).toBe(35);
  });

  it('includes return-to-depot travel time in driving total', () => {
    const returnLeg = { distanceKm: 12, durationMinutes: 15 };
    const m = calculateMetrics(stopsWithDistances, undefined, returnLeg);
    // Per-stop travel: 12 + 10 + 6 = 28 min. Return: 15 min. Total travel: 43 min.
    expect(m).not.toBeNull();
    expect(m!.travelTimeMin).toBe(43);
  });

  it('works without return-to-depot (null)', () => {
    const m = calculateMetrics(stopsWithDistances, undefined, null);
    expect(m).not.toBeNull();
    // Per-stop sum only: 10 + 8 + 5 = 23 km
    expect(m!.distanceKm).toBe(23);
    // Per-stop travel only: 12 + 10 + 6 = 28 min
    expect(m!.travelTimeMin).toBe(28);
  });

  it('works without return-to-depot (undefined / not passed)', () => {
    const m = calculateMetrics(stopsWithDistances);
    expect(m).not.toBeNull();
    expect(m!.distanceKm).toBe(23);
    expect(m!.travelTimeMin).toBe(28);
  });

  it('handles return leg with null distance/duration', () => {
    const returnLeg = { distanceKm: null, durationMinutes: null };
    const m = calculateMetrics(stopsWithDistances, undefined, returnLeg);
    expect(m).not.toBeNull();
    expect(m!.distanceKm).toBe(23);
    expect(m!.travelTimeMin).toBe(28);
  });

  it('return leg affects loadPercent (9h working day baseline)', () => {
    const returnLeg = { distanceKm: 12, durationMinutes: 15 };
    const withReturn = calculateMetrics(stopsWithDistances, undefined, returnLeg)!;
    const withoutReturn = calculateMetrics(stopsWithDistances, undefined, null)!;
    expect(withReturn.loadPercent).toBeGreaterThan(withoutReturn.loadPercent);
  });
});
