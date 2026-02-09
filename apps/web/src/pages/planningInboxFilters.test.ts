import { describe, expect, it } from 'vitest';
import type { CallQueueItem } from '../services/revisionService';
import {
  applyInboxFilters,
  type InboxFilters,
  getActiveFilterCount,
  toggleFilter,
} from './planningInboxFilters';

function buildCandidate(
  overrides: Partial<CallQueueItem> & Pick<CallQueueItem, 'id' | 'customerId'>,
): CallQueueItem {
  return {
    id: overrides.id,
    customerId: overrides.customerId,
    deviceId: 'device-1',
    userId: 'user-1',
    status: 'upcoming',
    dueDate: '2026-02-10',
    snoozeUntil: null,
    snoozeReason: null,
    customerName: 'Customer',
    customerPhone: '123456789',
    customerEmail: null,
    customerStreet: 'Main 1',
    customerCity: 'Prague',
    customerPostalCode: '11000',
    customerLat: 50.1,
    customerLng: 14.4,
    customerGeocodeStatus: 'success',
    deviceName: null,
    deviceType: 'extinguisher',
    daysUntilDue: 10,
    priority: 'due_soon',
    lastContactAt: null,
    contactAttempts: 0,
    ...overrides,
  };
}

const emptyFilters: InboxFilters = {
  time: [],
  schedule: [],
  route: [],
  problems: [],
};

describe('planningInboxFilters', () => {
  it('combines groups with AND logic', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1', daysUntilDue: -1, status: 'scheduled' }),
      buildCandidate({ id: '2', customerId: 'c2', daysUntilDue: -1, status: 'upcoming' }),
      buildCandidate({ id: '3', customerId: 'c3', daysUntilDue: 5, status: 'scheduled' }),
    ];

    const result = applyInboxFilters(
      candidates,
      { ...emptyFilters, time: ['overdue'], schedule: ['hasTerm'] },
      new Set<string>(),
    );

    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('uses OR logic inside schedule group', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1', status: 'scheduled' }),
      buildCandidate({ id: '2', customerId: 'c2', status: 'upcoming' }),
    ];

    const result = applyInboxFilters(
      candidates,
      { ...emptyFilters, schedule: ['hasTerm', 'noTerm'] },
      new Set<string>(),
    );

    expect(result).toHaveLength(2);
  });

  it('uses OR logic inside route group', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1' }),
      buildCandidate({ id: '2', customerId: 'c2' }),
    ];

    const result = applyInboxFilters(
      candidates,
      { ...emptyFilters, route: ['inRoute', 'notInRoute'] },
      new Set(['c1']),
    );

    expect(result).toHaveLength(2);
  });

  it('filters route presence correctly', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1' }),
      buildCandidate({ id: '2', customerId: 'c2' }),
    ];

    const onlyInRoute = applyInboxFilters(
      candidates,
      { ...emptyFilters, route: ['inRoute'] },
      new Set(['c1']),
    );
    const onlyOutsideRoute = applyInboxFilters(
      candidates,
      { ...emptyFilters, route: ['notInRoute'] },
      new Set(['c1']),
    );

    expect(onlyInRoute.map((c) => c.id)).toEqual(['1']);
    expect(onlyOutsideRoute.map((c) => c.id)).toEqual(['2']);
  });

  it('filters problem group by missing phone and address issues', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1', customerPhone: null }),
      buildCandidate({ id: '2', customerId: 'c2', customerLat: null, customerGeocodeStatus: 'failed' }),
      buildCandidate({ id: '3', customerId: 'c3' }),
    ];

    const missingPhone = applyInboxFilters(
      candidates,
      { ...emptyFilters, problems: ['missingPhone'] },
      new Set<string>(),
    );
    const addressIssue = applyInboxFilters(
      candidates,
      { ...emptyFilters, problems: ['addressIssue'] },
      new Set<string>(),
    );

    expect(missingPhone.map((c) => c.id)).toEqual(['1']);
    expect(addressIssue.map((c) => c.id)).toEqual(['2']);
  });

  it('counts active filters', () => {
    const count = getActiveFilterCount({
      time: ['thisWeek'],
      schedule: ['hasTerm'],
      route: ['notInRoute'],
      problems: ['addressIssue'],
    });

    expect(count).toBe(4);
  });

  it('toggles filter value in array', () => {
    expect(toggleFilter(['thisWeek'], 'thisMonth')).toEqual(['thisWeek', 'thisMonth']);
    expect(toggleFilter(['thisWeek', 'thisMonth'], 'thisWeek')).toEqual(['thisMonth']);
  });
});
