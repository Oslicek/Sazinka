/**
 * Shared test fixtures for visit-related tests.
 * Keeps test files DRY across A.1, A.2, A.3, A.4.
 */
import type { Visit } from '@shared/visit';
import type { VisitWorkItem } from '@shared/workItem';

export function makeVisitFixture(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'v-1',
    userId: 'u-1',
    customerId: 'c-1',
    scheduledDate: '2026-03-20',
    status: 'completed',
    visitType: 'revision',
    requiresFollowUp: false,
    createdAt: '2026-03-20T08:00:00Z',
    updatedAt: '2026-03-20T10:00:00Z',
    ...overrides,
  };
}

export function makeWorkItemFixture(overrides: Partial<VisitWorkItem> = {}): VisitWorkItem {
  return {
    id: 'wi-1',
    visitId: 'v-1',
    workType: 'revision',
    requiresFollowUp: false,
    createdAt: '2026-03-20T08:00:00Z',
    ...overrides,
  };
}

export function makeGetVisitResponse(
  visit: Visit,
  workItems: VisitWorkItem[] = [],
) {
  return {
    visit,
    customerName: null as string | null,
    customerStreet: null as string | null,
    customerCity: null as string | null,
    customerPostalCode: null as string | null,
    customerPhone: null as string | null,
    customerLat: null as number | null,
    customerLng: null as number | null,
    workItems,
  };
}
