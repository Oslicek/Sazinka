import { describe, it, expect } from 'vitest';
import { insertStopAtPosition, findChronologicalPosition } from './insertStop';
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
// insertStopAtPosition
// ---------------------------------------------------------------------------

describe('insertStopAtPosition', () => {
  it('inserts at the beginning of an empty list', () => {
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition([], newStop, 0);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('x');
    expect(result[0].stopOrder).toBe(1);
  });

  it('inserts at the end when insertAfterIndex equals list length', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition(stops, newStop, 2);
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'x']);
    expect(result.map((s) => s.stopOrder)).toEqual([1, 2, 3]);
  });

  it('inserts after the first stop', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
      makeStop({ id: 'c', stopOrder: 3 }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition(stops, newStop, 1);
    expect(result.map((s) => s.id)).toEqual(['a', 'x', 'b', 'c']);
    expect(result.map((s) => s.stopOrder)).toEqual([1, 2, 3, 4]);
  });

  it('inserts at position 0 (before all stops)', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
      makeStop({ id: 'b', stopOrder: 2 }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition(stops, newStop, 0);
    expect(result.map((s) => s.id)).toEqual(['x', 'a', 'b']);
    expect(result.map((s) => s.stopOrder)).toEqual([1, 2, 3]);
  });

  it('does not mutate the original array', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition(stops, newStop, 1);
    expect(result).not.toBe(stops);
    expect(stops).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it('clamps negative insertAfterIndex to 0', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition(stops, newStop, -1);
    expect(result.map((s) => s.id)).toEqual(['x', 'a']);
    expect(result.map((s) => s.stopOrder)).toEqual([1, 2]);
  });

  it('clamps insertAfterIndex beyond list length to end', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1 }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 });
    const result = insertStopAtPosition(stops, newStop, 99);
    expect(result.map((s) => s.id)).toEqual(['a', 'x']);
    expect(result.map((s) => s.stopOrder)).toEqual([1, 2]);
  });

  it('preserves all fields of existing stops', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, customerName: 'Alice', scheduledTimeStart: '09:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0, customerName: 'NewGuy' });
    const result = insertStopAtPosition(stops, newStop, 1);
    expect(result[0].customerName).toBe('Alice');
    expect(result[0].scheduledTimeStart).toBe('09:00');
    expect(result[1].customerName).toBe('NewGuy');
  });
});

// ---------------------------------------------------------------------------
// findChronologicalPosition
// ---------------------------------------------------------------------------

describe('findChronologicalPosition', () => {
  it('returns 0 for an empty list', () => {
    const newStop = makeStop({ id: 'x', stopOrder: 0, scheduledTimeStart: '10:00' });
    expect(findChronologicalPosition([], newStop)).toBe(0);
  });

  it('appends if no scheduledTimeStart on new stop', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '08:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0 }); // no scheduledTimeStart
    expect(findChronologicalPosition(stops, newStop)).toBe(stops.length);
  });

  it('inserts before the first stop when earlier', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '10:00' }),
      makeStop({ id: 'b', stopOrder: 2, scheduledTimeStart: '14:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0, scheduledTimeStart: '08:00' });
    expect(findChronologicalPosition(stops, newStop)).toBe(0);
  });

  it('inserts between two stops in chronological order', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '08:00' }),
      makeStop({ id: 'b', stopOrder: 2, scheduledTimeStart: '14:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0, scheduledTimeStart: '10:00' });
    expect(findChronologicalPosition(stops, newStop)).toBe(1);
  });

  it('appends when later than all existing stops', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '08:00' }),
      makeStop({ id: 'b', stopOrder: 2, scheduledTimeStart: '10:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0, scheduledTimeStart: '14:00' });
    expect(findChronologicalPosition(stops, newStop)).toBe(2);
  });

  it('skips break stops when determining position', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '08:00' }),
      makeStop({ id: 'brk', stopOrder: 2, stopType: 'break' }),
      makeStop({ id: 'b', stopOrder: 3, scheduledTimeStart: '14:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0, scheduledTimeStart: '10:00' });
    // Should insert at index 1 (before the break), since the next customer (14:00) is later
    // Actually, breaks don't have scheduledTimeStart so we skip them. The function
    // iterates in order: 'a' (08:00 < 10:00 → continue), 'brk' (skip, not customer), 'b' (14:00 > 10:00 → return 2)
    expect(findChronologicalPosition(stops, newStop)).toBe(2);
  });

  it('handles HH:MM:SS format', () => {
    const stops = [
      makeStop({ id: 'a', stopOrder: 1, scheduledTimeStart: '08:00:00' }),
      makeStop({ id: 'b', stopOrder: 2, scheduledTimeStart: '14:00:00' }),
    ];
    const newStop = makeStop({ id: 'x', stopOrder: 0, scheduledTimeStart: '10:00' });
    expect(findChronologicalPosition(stops, newStop)).toBe(1);
  });
});
