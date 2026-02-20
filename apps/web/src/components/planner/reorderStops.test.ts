import { describe, it, expect } from 'vitest';
import { reorderStops, needsScheduledTimeWarning } from './reorderStops';
import type { SavedRouteStop } from '../../services/routeService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStop(overrides: Partial<SavedRouteStop> & { id: string; stopOrder: number }): SavedRouteStop {
  return {
    routeId: 'r1',
    revisionId: null,
    estimatedArrival: null,
    estimatedDeparture: null,
    distanceFromPreviousKm: null,
    durationFromPreviousMinutes: null,
    status: 'upcoming',
    stopType: 'customer',
    customerId: null,
    customerName: null,
    address: null,
    customerLat: null,
    customerLng: null,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reorderStops
// ---------------------------------------------------------------------------

describe('reorderStops', () => {
  it('moves a stop from index 0 to index 2', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
      makeStop({ id: 'c', stopOrder: 3 }),
    ];
    const result = reorderStops(stops, 0, 2);
    expect(result.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a stop from index 2 to index 0', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
      makeStop({ id: 'c', stopOrder: 3 }),
    ];
    const result = reorderStops(stops, 2, 0);
    expect(result.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('reassigns stopOrder values as 1-indexed after reorder', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
      makeStop({ id: 'c', stopOrder: 3 }),
    ];
    const result = reorderStops(stops, 2, 0);
    expect(result.map((s) => s.stopOrder)).toEqual([1, 2, 3]);
  });

  it('returns a new array (does not mutate original)', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    const result = reorderStops(stops, 0, 1);
    expect(result).not.toBe(stops);
    // Original unchanged
    expect(stops[0].id).toBe('a');
    expect(stops[1].id).toBe('b');
  });

  it('handles same index (no-op)', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    const result = reorderStops(stops, 1, 1);
    expect(result.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('handles single element', () => {
    const stops = [makeStop({ id: 'a', stopOrder: 1 })];
    const result = reorderStops(stops, 0, 0);
    expect(result.map((s) => s.id)).toEqual(['a']);
    expect(result[0].stopOrder).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// needsScheduledTimeWarning
// ---------------------------------------------------------------------------

describe('needsScheduledTimeWarning', () => {
  it('returns the stop when a scheduled stop is moved', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '09:00', scheduledTimeEnd: '10:00', customerName: 'Karel' }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    const warning = needsScheduledTimeWarning(stops, 0, 1);
    expect(warning).not.toBeNull();
    expect(warning!.id).toBe('a');
    expect(warning!.customerName).toBe('Karel');
  });

  it('returns null when a non-scheduled stop is moved', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    expect(needsScheduledTimeWarning(stops, 0, 1)).toBeNull();
  });

  it('returns null when from === to (no move)', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '09:00', scheduledTimeEnd: '10:00' }),
    ];
    expect(needsScheduledTimeWarning(stops, 0, 0)).toBeNull();
  });

  it('returns null for a stop with only scheduledDate but no time', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledDate: '2026-02-01' }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    expect(needsScheduledTimeWarning(stops, 0, 1)).toBeNull();
  });

  it('returns null when a break with scheduledTimeStart is moved (breaks have no customer appointment)', () => {
    const stops = [
      makeStop({ id: 'c1', stopOrder: 1, scheduledTimeStart: '09:00', scheduledTimeEnd: '10:00' }),
      makeStop({ id: 'brk', stopOrder: 2, stopType: 'break', scheduledTimeStart: '12:30', scheduledTimeEnd: '13:15', breakDurationMinutes: 45 }),
      makeStop({ id: 'c2', stopOrder: 3, scheduledTimeStart: '14:00', scheduledTimeEnd: '15:00' }),
    ];
    expect(needsScheduledTimeWarning(stops, 1, 0)).toBeNull();
  });
});
