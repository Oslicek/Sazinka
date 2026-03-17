import type { InboxItem, InboxResponse } from '@shared/inbox';
import type { CallQueueItem, CallQueueResponse } from './revisionService';

function computeDaysUntilDue(nextActionDue: string | null): number {
  if (!nextActionDue) return 999;
  const due = new Date(nextActionDue + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function computePriority(daysUntilDue: number): CallQueueItem['priority'] {
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= 7) return 'due_this_week';
  if (daysUntilDue <= 14) return 'due_soon';
  return 'upcoming';
}

export function inboxItemToCallQueueItem(item: InboxItem): CallQueueItem {
  const daysUntilDue = computeDaysUntilDue(item.nextActionDue);

  return {
    id: item.id,
    deviceId: item.deviceId ?? '',
    customerId: item.id,
    userId: '',
    status: item.revisionStatus ?? 'upcoming',
    dueDate: item.nextActionDue ?? '',
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    customerName: item.name ?? '',
    customerPhone: item.phone ?? null,
    customerEmail: item.email ?? null,
    customerStreet: item.street ?? '',
    customerCity: item.city ?? '',
    customerPostalCode: item.postalCode ?? '',
    customerLat: item.lat,
    customerLng: item.lng,
    customerGeocodeStatus: (item.geocodeStatus as CallQueueItem['customerGeocodeStatus']) ?? 'pending',
    deviceName: item.deviceName ?? null,
    deviceType: item.deviceType ?? '',
    deviceTypeDefaultDurationMinutes: null,
    daysUntilDue,
    priority: computePriority(daysUntilDue),
    lastContactAt: item.lastContactAt,
    contactAttempts: item.totalCommunications,
  };
}

export function inboxResponseToCallQueueResponse(resp: InboxResponse): CallQueueResponse {
  return {
    items: resp.items.map(inboxItemToCallQueueItem),
    total: resp.total,
    overdueCount: resp.overdueCount,
    dueSoonCount: resp.dueSoonCount,
  };
}
