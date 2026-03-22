/**
 * Test data factories for Inbox / PlanningInbox tests.
 * Keep defaults minimal but type-valid; override per test as needed.
 */
import type { CallQueueItem } from '@/services/revisionService';
import type { SavedRouteStop } from '@/services/routeService';
import type { RouteContext } from '@/components/planner/RouteContextHeader';
import type { SlotSuggestion } from '@/components/planner/SlotSuggestions';
import type { Crew } from '@/services/crewService';
import type { Depot, UserSettings } from '@shared/settings';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Minimal valid CallQueueItem for UI tests */
export function createMockCallQueueItem(overrides: Partial<CallQueueItem> = {}): CallQueueItem {
  const customerId = overrides.customerId ?? nextId('cust');
  return {
    id: overrides.id ?? customerId,
    deviceId: overrides.deviceId ?? 'device-1',
    customerId,
    userId: overrides.userId ?? 'user-1',
    status: overrides.status ?? 'upcoming',
    dueDate: overrides.dueDate ?? new Date().toISOString().split('T')[0],
    scheduledDate: overrides.scheduledDate ?? null,
    scheduledTimeStart: overrides.scheduledTimeStart ?? null,
    scheduledTimeEnd: overrides.scheduledTimeEnd ?? null,
    customerName: overrides.customerName ?? 'Test Customer',
    customerPhone: overrides.customerPhone ?? '+420123456789',
    customerEmail: overrides.customerEmail ?? null,
    customerStreet: overrides.customerStreet ?? 'Test 1',
    customerCity: overrides.customerCity ?? 'Prague',
    customerPostalCode: overrides.customerPostalCode ?? '10000',
    customerLat: overrides.customerLat ?? 50.0755,
    customerLng: overrides.customerLng ?? 14.4378,
    customerGeocodeStatus: overrides.customerGeocodeStatus ?? 'success',
    deviceName: overrides.deviceName ?? 'Device A',
    deviceType: overrides.deviceType ?? 'type-a',
    deviceTypeDefaultDurationMinutes: overrides.deviceTypeDefaultDurationMinutes ?? 30,
    daysUntilDue: overrides.daysUntilDue ?? 5,
    priority: overrides.priority ?? 'upcoming',
    lastContactAt: overrides.lastContactAt ?? null,
    contactAttempts: overrides.contactAttempts ?? 0,
    latestScheduledRevisionId: overrides.latestScheduledRevisionId ?? null,
    scheduledRevisionCount: overrides.scheduledRevisionCount ?? 0,
  };
}

export function createMockSavedRouteStop(overrides: Partial<SavedRouteStop> = {}): SavedRouteStop {
  const id = overrides.id ?? nextId('stop');
  return {
    id,
    routeId: overrides.routeId ?? 'route-1',
    revisionId: overrides.revisionId ?? null,
    stopOrder: overrides.stopOrder ?? 1,
    estimatedArrival: overrides.estimatedArrival ?? '09:00',
    estimatedDeparture: overrides.estimatedDeparture ?? '09:30',
    distanceFromPreviousKm: overrides.distanceFromPreviousKm ?? 1,
    durationFromPreviousMinutes: overrides.durationFromPreviousMinutes ?? 10,
    status: overrides.status ?? 'draft',
    stopType: overrides.stopType ?? 'customer',
    customerId: overrides.customerId ?? 'cust-1',
    customerName: overrides.customerName ?? 'Customer',
    address: overrides.address ?? 'Street, City',
    customerLat: overrides.customerLat ?? 50.0,
    customerLng: overrides.customerLng ?? 14.0,
    customerPhone: overrides.customerPhone ?? null,
    customerEmail: overrides.customerEmail ?? null,
    scheduledDate: overrides.scheduledDate ?? null,
    scheduledTimeStart: overrides.scheduledTimeStart ?? null,
    scheduledTimeEnd: overrides.scheduledTimeEnd ?? null,
    revisionStatus: overrides.revisionStatus ?? null,
    ...overrides,
  };
}

export function createMockRouteContext(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    date: overrides.date ?? new Date().toISOString().split('T')[0],
    crewId: overrides.crewId ?? 'crew-1',
    crewName: overrides.crewName ?? 'Crew One',
    depotId: overrides.depotId ?? 'Depot A',
    depotName: overrides.depotName ?? 'Depot A',
  };
}

export function createMockSlotSuggestion(overrides: Partial<SlotSuggestion> = {}): SlotSuggestion {
  return {
    id: overrides.id ?? nextId('slot'),
    date: overrides.date ?? new Date().toISOString().split('T')[0],
    timeStart: overrides.timeStart ?? '10:00',
    timeEnd: overrides.timeEnd ?? '10:30',
    status: overrides.status ?? 'ok',
    deltaKm: overrides.deltaKm ?? 2,
    deltaMin: overrides.deltaMin ?? 5,
    insertAfterIndex: overrides.insertAfterIndex ?? 0,
    insertBeforeName: overrides.insertBeforeName,
    insertAfterName: overrides.insertAfterName,
  };
}

/** Depot row as returned by settings API (id is separate from name). */
export function createMockSettingsDepot(overrides: Partial<Depot> = {}): Depot {
  const name = overrides.name ?? 'Depot A';
  return {
    id: overrides.id ?? nextId('depot'),
    userId: overrides.userId ?? 'user-1',
    name,
    country: overrides.country ?? 'CZ',
    lat: overrides.lat ?? 50.1,
    lng: overrides.lng ?? 14.2,
    isPrimary: overrides.isPrimary ?? true,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

/** Minimal UserSettings for PlanningInbox loadSettings() */
export function createMinimalUserSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  const depots = overrides.depots ?? [createMockSettingsDepot()];
  return {
    workConstraints: overrides.workConstraints ?? {
      workingHoursStart: '08:00',
      workingHoursEnd: '17:00',
      maxRevisionsPerDay: 20,
      defaultServiceDurationMinutes: 30,
      defaultRevisionIntervalMonths: 12,
      reminderDaysBefore: [7, 3, 1],
    },
    businessInfo: overrides.businessInfo ?? {
      name: 'Test',
      email: 'test@example.com',
      companyLocale: 'cs',
    },
    emailTemplates: overrides.emailTemplates ?? {
      confirmationSubjectTemplate: '',
      confirmationBodyTemplate: '',
      reminderSubjectTemplate: '',
      reminderBodyTemplate: '',
      reminderSendTime: '09:00',
      thirdSubjectTemplate: '',
      thirdBodyTemplate: '',
      confirmationEditedAt: null,
      reminderEditedAt: null,
      thirdEditedAt: null,
    },
    depots,
    preferences: overrides.preferences ?? {
      defaultCrewId: null,
      defaultDepotId: null,
      locale: 'cs',
      lastArrivalBufferPercent: 10,
      lastArrivalBufferFixedMinutes: 0,
    },
    breakSettings: overrides.breakSettings ?? {
      breakEnabled: true,
      breakDurationMinutes: 45,
      breakEarliestTime: '11:30',
      breakLatestTime: '13:00',
      breakMinKm: 40,
      breakMaxKm: 120,
    },
    ...overrides,
  };
}

export function createMockCrew(overrides: Partial<Crew> = {}): Crew {
  const id = overrides.id ?? nextId('crew');
  return {
    id,
    userId: overrides.userId ?? 'user-1',
    name: overrides.name ?? 'Crew One',
    homeDepotId: overrides.homeDepotId ?? null,
    preferredAreas: overrides.preferredAreas ?? [],
    workingHoursStart: overrides.workingHoursStart ?? '08:00',
    workingHoursEnd: overrides.workingHoursEnd ?? '17:00',
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}
