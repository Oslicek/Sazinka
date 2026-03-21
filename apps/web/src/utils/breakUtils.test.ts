import { describe, it, expect, vi } from 'vitest';
import type { SavedRouteStop } from '../services/routeService';
import type { BreakSettings } from '@shared/settings';

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params ?? {})}`,
  },
}));

import { calculateBreakPosition, createBreakStop, validateBreak } from './breakUtils';

const DEFAULT_BREAK_SETTINGS: BreakSettings = {
  breakEnabled: true,
  breakDurationMinutes: 30,
  breakEarliestTime: '11:30',
  breakLatestTime: '12:30',
  breakMinKm: 10,
  breakMaxKm: 80,
};

function makeCustomerStop(overrides: Partial<SavedRouteStop> = {}): SavedRouteStop {
  return {
    id: 'stop-1',
    routeId: 'route-1',
    revisionId: null,
    stopOrder: 1,
    estimatedArrival: null,
    estimatedDeparture: null,
    distanceFromPreviousKm: 0,
    durationFromPreviousMinutes: 0,
    status: 'pending',
    stopType: 'customer',
    customerId: 'cust-1',
    customerName: 'Customer',
    address: 'Main St',
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

describe('calculateBreakPosition', () => {
  it('returns no insertion when break is disabled', () => {
    const result = calculateBreakPosition(
      [makeCustomerStop()],
      { ...DEFAULT_BREAK_SETTINGS, breakEnabled: false },
      '08:00',
    );

    expect(result).toEqual({
      position: 0,
      warnings: [],
      estimatedTime: null,
      estimatedDistanceKm: null,
    });
  });

  it('selects a valid gap when time and km constraints match', () => {
    const stops: SavedRouteStop[] = [
      makeCustomerStop({
        id: 's1',
        stopOrder: 1,
        scheduledTimeStart: '09:00',
        scheduledTimeEnd: '09:30',
        durationFromPreviousMinutes: 30,
        distanceFromPreviousKm: 12,
      }),
      makeCustomerStop({
        id: 's2',
        stopOrder: 2,
        scheduledTimeStart: '13:00',
        scheduledTimeEnd: '13:30',
        durationFromPreviousMinutes: 30,
        distanceFromPreviousKm: 15,
      }),
    ];

    const result = calculateBreakPosition(stops, DEFAULT_BREAK_SETTINGS, '08:00');
    expect(result.position).toBe(1);
    expect(result.estimatedTime).toBe('11:30');
    expect(result.estimatedDistanceKm).toBe(12);
    expect(result.warnings).toHaveLength(0);
  });

  it('emits warning when only time constraint matches but km is out of range', () => {
    const stops: SavedRouteStop[] = [
      makeCustomerStop({
        id: 's1',
        stopOrder: 1,
        scheduledTimeStart: '09:00',
        scheduledTimeEnd: '09:30',
        durationFromPreviousMinutes: 30,
        distanceFromPreviousKm: 12,
      }),
      makeCustomerStop({
        id: 's2',
        stopOrder: 2,
        scheduledTimeStart: '13:00',
        scheduledTimeEnd: '13:30',
        durationFromPreviousMinutes: 30,
        distanceFromPreviousKm: 15,
      }),
    ];

    const result = calculateBreakPosition(
      stops,
      { ...DEFAULT_BREAK_SETTINGS, breakMinKm: 25, breakMaxKm: 80 },
      '08:00',
    );
    expect(result.position).toBe(1);
    expect(result.warnings.some((w) => w.includes('km_out_of_range'))).toBe(true);
  });
});

describe('createBreakStop', () => {
  it('creates a floating break by default', () => {
    const stop = createBreakStop('route-1', 2, DEFAULT_BREAK_SETTINGS, '11:30');
    expect(stop.stopType).toBe('break');
    expect(stop.breakTimeStart).toBeNull();
    expect(stop.scheduledTimeStart).toBe('11:30');
    expect(stop.scheduledTimeEnd).toBe('12:00');
    expect(stop.estimatedDeparture).toBe('12:00');
  });

  it('creates a pinned break when floating=false', () => {
    const stop = createBreakStop('route-1', 2, DEFAULT_BREAK_SETTINGS, '11:30', { floating: false });
    expect(stop.breakTimeStart).toBe('11:30');
  });
});

describe('validateBreak', () => {
  it('returns no warnings when break has no explicit breakTimeStart', () => {
    const breakStop = makeCustomerStop({
      stopType: 'break',
      breakTimeStart: null,
    });
    const warnings = validateBreak(breakStop, DEFAULT_BREAK_SETTINGS, 30);
    expect(warnings).toEqual([]);
  });

  it('returns both time and km warnings when out of range', () => {
    const breakStop = makeCustomerStop({
      stopType: 'break',
      breakTimeStart: '10:00',
    });
    const warnings = validateBreak(
      breakStop,
      { ...DEFAULT_BREAK_SETTINGS, breakEarliestTime: '11:30', breakLatestTime: '12:30', breakMinKm: 20, breakMaxKm: 30 },
      5,
    );
    expect(warnings.some((w) => w.includes('time_out_of_range'))).toBe(true);
    expect(warnings.some((w) => w.includes('km_out_of_range'))).toBe(true);
  });
});
