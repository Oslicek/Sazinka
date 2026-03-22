/**
 * Default payloads for mocking NATS-backed services in PlanningInbox tests.
 * Use with vi.fn().mockResolvedValue(...).
 */
import type { CallQueueResponse } from '@/services/revisionService';
import { createMinimalUserSettings, createMockCallQueueItem, createMockCrew } from './inbox';

export const emptyCallQueueResponse: CallQueueResponse = {
  items: [],
  total: 0,
  overdueCount: 0,
  dueSoonCount: 0,
};

export function createInboxResponseWithOneCandidate(): CallQueueResponse {
  return {
    items: [createMockCallQueueItem({ customerId: 'cust-flow-1', customerName: 'Flow Customer' })],
    total: 1,
    overdueCount: 0,
    dueSoonCount: 0,
  };
}

/** Settings that give PlanningInbox a primary depot (id = depot name) and one crew */
export function defaultPlanningInboxSettings() {
  return createMinimalUserSettings({
    depots: [
      {
        id: 'dep-1',
        userId: 'user-1',
        name: 'Main Depot',
        country: 'CZ',
        lat: 50.1,
        lng: 14.3,
        isPrimary: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
}

export function defaultCrewList() {
  return [createMockCrew({ id: 'crew-1', name: 'Crew 1' })];
}
