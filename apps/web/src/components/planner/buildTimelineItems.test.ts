import { describe, it, expect } from 'vitest';
import { buildTimelineItems, type TimelineItem } from './buildTimelineItems';
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

function types(items: TimelineItem[]): string[] {
  return items.map((i) => i.type);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTimelineItems', () => {
  // ── Empty route ──

  it('returns depot-start and depot-end for an empty route', () => {
    const items = buildTimelineItems([], '08:00', '16:00');
    expect(types(items)).toEqual(['depot', 'depot']);
    expect(items[0].startTime).toBe('08:00');
    expect(items[1].startTime).toBe('16:00');
  });

  // ── Single customer stop ──

  it('returns depot → travel → stop → travel → depot when travel fills time exactly', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '08:25',
        estimatedDeparture: '09:25',
        distanceFromPreviousKm: 15,
        durationFromPreviousMinutes: 25,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');

    // Travel exactly fills: 08:00 + 25 min = 08:25 = arrival → no gap
    expect(types(items)).toEqual(['depot', 'travel', 'stop', 'travel', 'depot']);

    // First travel: depot → stop (25 min, 15 km)
    const travel1 = items[1];
    expect(travel1.durationMinutes).toBe(25);
    expect(travel1.distanceKm).toBe(15);
    expect(travel1.startTime).toBe('08:00');
    expect(travel1.endTime).toBe('08:25');

    // Stop
    const stop = items[2];
    expect(stop.durationMinutes).toBe(60);
    expect(stop.startTime).toBe('08:25');
    expect(stop.endTime).toBe('09:25');
    expect(stop.stop?.id).toBe('s1');

    // Return travel has no data (unknown) → duration 0
    const travel2 = items[3];
    expect(travel2.type).toBe('travel');
  });

  // ── Two stops with a gap between them ──

  it('detects a gap between two stops when departure + travel < next arrival', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '08:20',
        estimatedDeparture: '09:00',
        distanceFromPreviousKm: 10,
        durationFromPreviousMinutes: 20,
      }),
      makeStop({
        id: 's2',
        stopOrder: 2,
        estimatedArrival: '10:30',
        estimatedDeparture: '11:00',
        distanceFromPreviousKm: 5,
        durationFromPreviousMinutes: 15,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');

    // Travel1: 08:00+20=08:20 → stop1 at 08:20 (no gap before s1)
    // After s1: 09:00. Travel2: 09:00+15=09:15. Gap: 09:15→10:30 (75min)
    expect(types(items)).toEqual([
      'depot', 'travel', 'stop', 'travel', 'gap', 'stop', 'travel', 'depot',
    ]);

    const gap = items.find((i) => i.type === 'gap')!;
    expect(gap.durationMinutes).toBe(75); // 10:30 - 09:15
    expect(gap.startTime).toBe('09:15');
    expect(gap.endTime).toBe('10:30');
    expect(gap.insertAfterIndex).toBe(0); // insert after stop index 0
  });

  // ── No gap when travel fills the time ──

  it('has no gap when travel exactly fills the time between stops', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '08:20',
        estimatedDeparture: '09:00',
        distanceFromPreviousKm: 10,
        durationFromPreviousMinutes: 20,
      }),
      makeStop({
        id: 's2',
        stopOrder: 2,
        estimatedArrival: '09:15',
        estimatedDeparture: '09:45',
        distanceFromPreviousKm: 5,
        durationFromPreviousMinutes: 15,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');

    // Travel1: 08:00+20=08:20 → s1 (no gap). After s1: 09:00.
    // Travel2: 09:00+15=09:15 → s2 at 09:15 (no gap).
    expect(types(items)).toEqual([
      'depot', 'travel', 'stop', 'travel', 'stop', 'travel', 'depot',
    ]);
  });

  // ── Break stop ──

  it('represents a break stop with type "break"', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '09:00',
        estimatedDeparture: '10:00',
        distanceFromPreviousKm: 10,
        durationFromPreviousMinutes: 20,
      }),
      makeStop({
        id: 'b1',
        stopOrder: 2,
        stopType: 'break',
        breakTimeStart: '10:00',
        breakDurationMinutes: 45,
        estimatedArrival: '10:00',
        estimatedDeparture: '10:45',
        distanceFromPreviousKm: 0,
        durationFromPreviousMinutes: 0,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');

    const breakItem = items.find((i) => i.type === 'break');
    expect(breakItem).toBeDefined();
    expect(breakItem!.durationMinutes).toBe(45);
    expect(breakItem!.stop?.id).toBe('b1');
  });

  // ── Return-to-depot segment ──

  it('includes return-to-depot travel when returnToDepot is provided', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '09:00',
        estimatedDeparture: '10:00',
        distanceFromPreviousKm: 10,
        durationFromPreviousMinutes: 20,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00', {
      distanceKm: 12,
      durationMinutes: 22,
    });

    const lastTravel = items.filter((i) => i.type === 'travel').pop()!;
    expect(lastTravel.durationMinutes).toBe(22);
    expect(lastTravel.distanceKm).toBe(12);
    expect(lastTravel.startTime).toBe('10:00');
    expect(lastTravel.endTime).toBe('10:22');
  });

  // ── Duration calculations ──

  it('calculates stop duration from arrival/departure difference', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '08:30',
        estimatedDeparture: '09:45',
        distanceFromPreviousKm: 5,
        durationFromPreviousMinutes: 10,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');
    const stop = items.find((i) => i.type === 'stop')!;
    expect(stop.durationMinutes).toBe(75); // 09:45 - 08:30
  });

  // ── Missing time data ──

  it('uses 0 duration when arrival/departure times are missing', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: null,
        estimatedDeparture: null,
        distanceFromPreviousKm: null,
        durationFromPreviousMinutes: null,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');
    const stop = items.find((i) => i.type === 'stop')!;
    expect(stop.durationMinutes).toBe(0);
  });

  // ── Gap at start of day ──

  it('detects a gap between workday start and first stop when travel does not fill it', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1',
        stopOrder: 1,
        estimatedArrival: '10:00',
        estimatedDeparture: '11:00',
        distanceFromPreviousKm: 10,
        durationFromPreviousMinutes: 20,
      }),
    ];
    // Travel from 08:00 takes 20 min → arrives at 08:20, but stop starts at 10:00
    // Gap: 08:20 → 10:00 = 100 min
    const items = buildTimelineItems(stops, '08:00', '16:00');
    expect(types(items)).toContain('gap');
    const gap = items.find((i) => i.type === 'gap')!;
    expect(gap.durationMinutes).toBe(100);
    expect(gap.startTime).toBe('08:20');
    expect(gap.endTime).toBe('10:00');
    expect(gap.insertAfterIndex).toBe(-1); // before first stop
  });

  // ── Three stops, multiple gaps ──

  it('handles multiple stops with multiple gaps correctly', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1', stopOrder: 1,
        estimatedArrival: '08:10', estimatedDeparture: '09:00',
        distanceFromPreviousKm: 5, durationFromPreviousMinutes: 10,
      }),
      makeStop({
        id: 's2', stopOrder: 2,
        estimatedArrival: '11:00', estimatedDeparture: '11:30',
        distanceFromPreviousKm: 3, durationFromPreviousMinutes: 10,
      }),
      makeStop({
        id: 's3', stopOrder: 3,
        estimatedArrival: '13:00', estimatedDeparture: '13:30',
        distanceFromPreviousKm: 4, durationFromPreviousMinutes: 15,
      }),
    ];
    // Travel1: 08:00+10=08:10 → s1 (no gap). After s1: 09:00.
    // Travel2: 09:00+10=09:10. Gap: 09:10→11:00 (110 min). s2.
    // After s2: 11:30. Travel3: 11:30+15=11:45. Gap: 11:45→13:00 (75 min). s3.
    const items = buildTimelineItems(stops, '08:00', '16:00');
    const gaps = items.filter((i) => i.type === 'gap');
    expect(gaps.length).toBe(2);
    expect(gaps[0].insertAfterIndex).toBe(0);
    expect(gaps[1].insertAfterIndex).toBe(1);
  });

  // ── Recalculated stops (all fields populated) ──

  it('builds a tight route with no gaps when recalculated ETAs leave no slack', () => {
    // Simulates the result of a recalculate call: every field is populated,
    // travel times exactly fill the intervals between stops.
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1', stopOrder: 1,
        estimatedArrival: '08:20', estimatedDeparture: '09:20',
        distanceFromPreviousKm: 12, durationFromPreviousMinutes: 20,
        serviceDurationMinutes: 60,
      }),
      makeStop({
        id: 's2', stopOrder: 2,
        estimatedArrival: '09:35', estimatedDeparture: '10:35',
        distanceFromPreviousKm: 8, durationFromPreviousMinutes: 15,
        serviceDurationMinutes: 60,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00', {
      distanceKm: 10, durationMinutes: 18,
    });
    // No gaps expected: travel exactly fills intervals
    expect(types(items)).toEqual([
      'depot', 'travel', 'stop', 'travel', 'stop', 'travel', 'depot',
    ]);
    // Verify return travel
    const returnTravel = items.find((i) => i.id === 'travel-return')!;
    expect(returnTravel.durationMinutes).toBe(18);
    expect(returnTravel.distanceKm).toBe(10);
    // End depot time = 10:35 + 18 min = 10:53
    const endDepot = items.find((i) => i.id === 'depot-end')!;
    expect(endDepot.startTime).toBe('10:53');
  });

  it('handles stops transitioning from null ETAs to populated (after recalc)', () => {
    // Before recalculation: no arrival/departure data
    const before: SavedRouteStop[] = [
      makeStop({ id: 's1', stopOrder: 1 }),
      makeStop({ id: 's2', stopOrder: 2 }),
    ];
    const itemsBefore = buildTimelineItems(before, '08:00', '16:00');
    const stopsBefore = itemsBefore.filter((i) => i.type === 'stop');
    expect(stopsBefore.every((s) => s.durationMinutes === 0)).toBe(true);

    // After recalculation: all data populated
    const after: SavedRouteStop[] = [
      makeStop({
        id: 's1', stopOrder: 1,
        estimatedArrival: '08:25', estimatedDeparture: '09:25',
        distanceFromPreviousKm: 15, durationFromPreviousMinutes: 25,
      }),
      makeStop({
        id: 's2', stopOrder: 2,
        estimatedArrival: '09:40', estimatedDeparture: '10:40',
        distanceFromPreviousKm: 8, durationFromPreviousMinutes: 15,
      }),
    ];
    const itemsAfter = buildTimelineItems(after, '08:00', '16:00');
    const stopsAfter = itemsAfter.filter((i) => i.type === 'stop');
    expect(stopsAfter[0].durationMinutes).toBe(60);
    expect(stopsAfter[1].durationMinutes).toBe(60);
    expect(stopsAfter[0].startTime).toBe('08:25');
    expect(stopsAfter[1].startTime).toBe('09:40');
  });

  // ── Late arrival / schedule conflict ──

  it('flags a stop as late when travel makes actual arrival later than scheduled start', () => {
    // Radek ends at 09:00, travel to Alena is 17 min → actual ETA 09:17
    // But Alena's scheduled time is 09:00. This is a conflict.
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'radek', stopOrder: 1,
        estimatedArrival: '08:00', estimatedDeparture: '09:00',
        scheduledTimeStart: '08:00', scheduledTimeEnd: '09:00',
        distanceFromPreviousKm: 55, durationFromPreviousMinutes: 40,
      }),
      makeStop({
        id: 'alena', stopOrder: 2,
        estimatedArrival: '09:00', estimatedDeparture: '10:00',
        scheduledTimeStart: '09:00', scheduledTimeEnd: '10:00',
        distanceFromPreviousKm: 17, durationFromPreviousMinutes: 17,
      }),
    ];
    const items = buildTimelineItems(stops, '07:00', '16:00');

    // Find Alena's stop item
    const alenaItem = items.find((i) => i.stop?.id === 'alena')!;
    expect(alenaItem).toBeDefined();
    // She should be flagged as late by 17 minutes
    expect(alenaItem.lateArrivalMinutes).toBe(17);
    // The actual arrival should be 09:17
    expect(alenaItem.actualArrivalTime).toBe('09:17');
  });

  it('does not flag a stop as late when travel finishes before scheduled start', () => {
    // Radek ends at 09:00, travel to Alena is 10 min → actual ETA 09:10
    // Alena's scheduled time is 10:00. No conflict — plenty of time.
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'radek', stopOrder: 1,
        estimatedArrival: '08:00', estimatedDeparture: '09:00',
        scheduledTimeStart: '08:00', scheduledTimeEnd: '09:00',
        distanceFromPreviousKm: 55, durationFromPreviousMinutes: 40,
      }),
      makeStop({
        id: 'alena', stopOrder: 2,
        estimatedArrival: '10:00', estimatedDeparture: '11:00',
        scheduledTimeStart: '10:00', scheduledTimeEnd: '11:00',
        distanceFromPreviousKm: 17, durationFromPreviousMinutes: 10,
      }),
    ];
    const items = buildTimelineItems(stops, '07:00', '16:00');

    const alenaItem = items.find((i) => i.stop?.id === 'alena')!;
    expect(alenaItem.lateArrivalMinutes).toBeUndefined();
    expect(alenaItem.actualArrivalTime).toBeUndefined();
  });

  it('shows travel segment at full duration even when it overlaps with next scheduled stop', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'radek', stopOrder: 1,
        estimatedArrival: '08:00', estimatedDeparture: '09:00',
        scheduledTimeStart: '08:00', scheduledTimeEnd: '09:00',
        distanceFromPreviousKm: 55, durationFromPreviousMinutes: 40,
      }),
      makeStop({
        id: 'alena', stopOrder: 2,
        estimatedArrival: '09:00', estimatedDeparture: '10:00',
        scheduledTimeStart: '09:00', scheduledTimeEnd: '10:00',
        distanceFromPreviousKm: 17, durationFromPreviousMinutes: 17,
      }),
    ];
    const items = buildTimelineItems(stops, '07:00', '16:00');

    // Travel segment to Alena should have full 17 min duration
    const travelToAlena = items.find((i) => i.id === 'travel-1')!;
    expect(travelToAlena.durationMinutes).toBe(17);
    expect(travelToAlena.startTime).toBe('09:00');
    expect(travelToAlena.endTime).toBe('09:17');
  });

  it('does not insert a gap between travel and a late stop', () => {
    // s1 ends at 09:00, travel to s2 is 17 min → arrival 09:17.
    // s2 scheduled at 09:00 → cursor(09:17) > arrival(09:00) → no gap between.
    // s1 travel fills exactly: 08:43 + 17 min = 09:00 → no gap before s1 either.
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1', stopOrder: 1,
        estimatedArrival: '08:43', estimatedDeparture: '09:00',
        scheduledTimeStart: '08:43', scheduledTimeEnd: '09:00',
        distanceFromPreviousKm: 55, durationFromPreviousMinutes: 43,
      }),
      makeStop({
        id: 's2', stopOrder: 2,
        estimatedArrival: '09:00', estimatedDeparture: '10:00',
        scheduledTimeStart: '09:00', scheduledTimeEnd: '10:00',
        distanceFromPreviousKm: 17, durationFromPreviousMinutes: 17,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');

    // Sequence: depot, travel(43min), stop(s1), travel(17min), stop(s2-late), travel, depot
    // No gap should appear between the travel and the late stop
    const itemTypes = types(items);
    expect(itemTypes).toEqual([
      'depot', 'travel', 'stop', 'travel', 'stop', 'travel', 'depot',
    ]);

    // s2 should be flagged as late
    const s2Item = items.find((i) => i.stop?.id === 's2')!;
    expect(s2Item.lateArrivalMinutes).toBe(17);
  });

  it('populates agreed window fields for flexible stops', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'flex-1',
        stopOrder: 1,
        estimatedArrival: '09:30',
        estimatedDeparture: '10:30',
        scheduledTimeStart: '08:00',
        scheduledTimeEnd: '12:00',
        serviceDurationMinutes: 60,
        durationFromPreviousMinutes: 30,
      }),
    ];
    const items = buildTimelineItems(stops, '09:00', '16:00');
    const stop = items.find((i) => i.type === 'stop')!;
    expect(stop.agreedWindowStart).toBe('08:00');
    expect(stop.agreedWindowEnd).toBe('12:00');
    expect(stop.agreedWindowDurationMinutes).toBe(240);
  });

  it('populates agreed window for pinned scheduled stops but not flexible duration', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'pinned-1',
        stopOrder: 1,
        estimatedArrival: '09:00',
        estimatedDeparture: '10:00',
        scheduledTimeStart: '09:00',
        scheduledTimeEnd: '10:00',
        serviceDurationMinutes: 60,
        durationFromPreviousMinutes: 10,
      }),
      makeStop({
        id: 'legacy-1',
        stopOrder: 2,
        estimatedArrival: '10:30',
        estimatedDeparture: '11:30',
        scheduledTimeStart: '10:30',
        scheduledTimeEnd: '11:30',
        serviceDurationMinutes: null,
        durationFromPreviousMinutes: 30,
      }),
    ];
    const items = buildTimelineItems(stops, '08:50', '16:00');
    const pinned = items.find((i) => i.stop?.id === 'pinned-1')!;
    const legacy = items.find((i) => i.stop?.id === 'legacy-1')!;
    expect(pinned.agreedWindowStart).toBe('09:00');
    expect(pinned.agreedWindowEnd).toBe('10:00');
    expect(pinned.agreedWindowDurationMinutes).toBeUndefined();
    expect(legacy.agreedWindowStart).toBe('10:30');
    expect(legacy.agreedWindowEnd).toBe('11:30');
    expect(legacy.agreedWindowDurationMinutes).toBeUndefined();
  });

  // ── Break with stale times after reorder ──

  it('places a break at cursor when its breakTimeStart is stale (before cursor)', () => {
    // After a reorder, the break ends up last in the array but its breakTimeStart
    // is from before the reorder (07:45). The cursor after KominServis is 11:00.
    // The break should start at 11:00, not 07:45, and no huge gap should appear.
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'c1', stopOrder: 1,
        estimatedArrival: '08:00', estimatedDeparture: '09:00',
        distanceFromPreviousKm: 64, durationFromPreviousMinutes: 45,
      }),
      makeStop({
        id: 'c2', stopOrder: 2,
        estimatedArrival: '09:30', estimatedDeparture: '10:00',
        distanceFromPreviousKm: 24, durationFromPreviousMinutes: 20,
      }),
      makeStop({
        id: 'c3', stopOrder: 3,
        estimatedArrival: '10:15', estimatedDeparture: '11:00',
        distanceFromPreviousKm: 10, durationFromPreviousMinutes: 10,
      }),
      makeStop({
        id: 'brk', stopOrder: 4, stopType: 'break',
        breakTimeStart: '07:45', breakDurationMinutes: 45,
        estimatedArrival: '07:45', estimatedDeparture: '08:30',
      }),
    ];
    const items = buildTimelineItems(stops, '07:00', '16:00');

    const breakItem = items.find((i) => i.type === 'break')!;
    expect(breakItem).toBeDefined();
    // Break should start at cursor (11:00), not stale 07:45
    expect(breakItem.startTime).toBe('11:00');
    expect(breakItem.endTime).toBe('11:45');
    expect(breakItem.durationMinutes).toBe(45);

    // There should be no gap > 1h in the timeline (the stale time would create a 3h+ gap)
    const gaps = items.filter((i) => i.type === 'gap');
    for (const gap of gaps) {
      expect(gap.durationMinutes).toBeLessThan(60);
    }
  });

  it('places a break in a gap when its breakTimeStart is valid and ahead of cursor', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 'c1', stopOrder: 1,
        estimatedArrival: '08:00', estimatedDeparture: '09:00',
        distanceFromPreviousKm: 64, durationFromPreviousMinutes: 45,
      }),
      makeStop({
        id: 'brk', stopOrder: 2, stopType: 'break',
        breakTimeStart: '10:00', breakDurationMinutes: 45,
        estimatedArrival: '10:00', estimatedDeparture: '10:45',
      }),
      makeStop({
        id: 'c2', stopOrder: 3,
        estimatedArrival: '11:30', estimatedDeparture: '12:00',
        distanceFromPreviousKm: 24, durationFromPreviousMinutes: 20,
      }),
    ];
    const items = buildTimelineItems(stops, '07:00', '16:00');

    const breakItem = items.find((i) => i.type === 'break')!;
    expect(breakItem).toBeDefined();
    expect(breakItem.startTime).toBe('10:00');
    expect(breakItem.endTime).toBe('10:45');
  });

  // ── Unique IDs ──

  it('assigns unique IDs to every item', () => {
    const stops: SavedRouteStop[] = [
      makeStop({
        id: 's1', stopOrder: 1,
        estimatedArrival: '08:20', estimatedDeparture: '09:00',
        distanceFromPreviousKm: 10, durationFromPreviousMinutes: 20,
      }),
      makeStop({
        id: 's2', stopOrder: 2,
        estimatedArrival: '11:00', estimatedDeparture: '12:00',
        distanceFromPreviousKm: 5, durationFromPreviousMinutes: 15,
      }),
    ];
    const items = buildTimelineItems(stops, '08:00', '16:00');
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
