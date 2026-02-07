import type { CalendarItem, CalendarItemType, CalendarItemStatus } from '@shared/calendar';
import type { Revision } from '@shared/revision';
import type { Visit } from '@shared/visit';
import type { Communication } from '@shared/communication';
import { listRevisions } from './revisionService';
import { listVisits, getVisitTypeLabel } from './visitService';
import { listCommunications, getCommunicationTypeLabel } from './communicationService';

export type CalendarViewMode = 'due' | 'scheduled';

export interface CalendarItemFilters {
  startDate: string;
  endDate: string;
  viewMode?: CalendarViewMode;
  types?: CalendarItemType[];
  status?: CalendarItemStatus[];
  crewId?: string;
  customerQuery?: string;
}

export interface CalendarItemsResponse {
  items: CalendarItem[];
}

function normalizeDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  return dateStr.substring(0, 10);
}

function getRevisionStatus(revision: Revision): CalendarItemStatus {
  if (revision.status === 'completed') return 'completed';
  if (revision.status === 'cancelled') return 'cancelled';
  if (revision.status === 'scheduled' || revision.status === 'confirmed') return 'scheduled';
  const dueDate = new Date(revision.dueDate);
  const today = new Date();
  if (dueDate < today) return 'overdue';
  return 'due';
}

function mapRevisionToCalendarItem(revision: Revision, viewMode: CalendarViewMode): CalendarItem | null {
  const dateStr = viewMode === 'scheduled' ? revision.scheduledDate : revision.dueDate;
  const date = normalizeDate(dateStr);
  if (!date) return null;
  return {
    id: revision.id,
    type: 'revision',
    date,
    status: getRevisionStatus(revision),
    title: revision.customerName || 'Zákazník',
    subtitle: revision.deviceType || revision.deviceName || 'Zařízení',
    timeStart: revision.scheduledTimeStart ?? null,
    timeEnd: revision.scheduledTimeEnd ?? null,
    customerId: revision.customerId,
    customerName: revision.customerName,
    deviceId: revision.deviceId,
    deviceType: revision.deviceType,
    crewId: revision.assignedCrewId ?? null,
    sourceStatus: revision.status,
    sourceType: 'revision',
  };
}

function getVisitStatus(visit: Visit): CalendarItemStatus {
  if (visit.status === 'completed') return 'completed';
  if (visit.status === 'cancelled') return 'cancelled';
  if (visit.status === 'in_progress') return 'in_progress';
  if (visit.status === 'rescheduled') return 'scheduled';
  return 'scheduled';
}

function mapVisitToCalendarItem(visit: Visit): CalendarItem | null {
  const date = normalizeDate(visit.scheduledDate);
  if (!date) return null;
  return {
    id: visit.id,
    type: 'visit',
    date,
    status: getVisitStatus(visit),
    title: visit.customerName || 'Zákazník',
    subtitle: getVisitTypeLabel(visit.visitType),
    timeStart: visit.scheduledTimeStart ?? null,
    timeEnd: visit.scheduledTimeEnd ?? null,
    customerId: visit.customerId,
    customerName: visit.customerName,
    deviceId: visit.deviceId ?? undefined,
    crewId: visit.crewId ?? null,
    sourceStatus: visit.status,
    sourceType: visit.visitType,
  };
}

function getCommunicationStatus(comm: Communication): CalendarItemStatus {
  if (comm.followUpCompleted) return 'completed';
  if (!comm.followUpDate) return 'pending';
  const followUpDate = new Date(comm.followUpDate);
  const today = new Date();
  if (followUpDate < today) return 'overdue';
  return 'pending';
}

function mapCommunicationToCalendarItem(comm: Communication): CalendarItem | null {
  const date = normalizeDate(comm.followUpDate ?? undefined);
  if (!date) return null;
  return {
    id: comm.id,
    type: 'task',
    date,
    status: getCommunicationStatus(comm),
    title: comm.contactName || 'Follow-up',
    subtitle: getCommunicationTypeLabel(comm.commType),
    customerId: comm.customerId,
    sourceStatus: comm.commType,
    sourceType: 'communication',
    priority: comm.followUpDate ? 'medium' : 'low',
  };
}

function filterByCustomerQuery(items: CalendarItem[], query?: string): CalendarItem[] {
  if (!query) return items;
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => (item.customerName || '').toLowerCase().includes(q));
}

function filterByStatus(items: CalendarItem[], statuses?: CalendarItemStatus[]): CalendarItem[] {
  if (!statuses || statuses.length === 0) return items;
  const allowed = new Set(statuses);
  return items.filter((item) => allowed.has(item.status));
}

function filterByCrew(items: CalendarItem[], crewId?: string): CalendarItem[] {
  if (!crewId) return items;
  return items.filter((item) => item.crewId === crewId);
}

export async function listCalendarItems(
  userId: string,
  filters: CalendarItemFilters
): Promise<CalendarItemsResponse> {
  const viewMode = filters.viewMode ?? 'due';
  const types = filters.types ?? ['revision', 'visit', 'task'];

  const [revisionsResponse, visitsResponse, communicationsResponse] = await Promise.all([
    types.includes('revision')
      ? listRevisions(userId, {
          fromDate: filters.startDate,
          toDate: filters.endDate,
          dateType: viewMode,
          limit: 1000,
        })
      : Promise.resolve({ items: [] }),
    types.includes('visit')
      ? listVisits({
          dateFrom: filters.startDate,
          dateTo: filters.endDate,
          limit: 1000,
        })
      : Promise.resolve({ visits: [], total: 0 }),
    types.includes('task')
      ? listCommunications({
          followUpPending: true,
          limit: 1000,
        })
      : Promise.resolve({ communications: [], total: 0 }),
  ]);

  const revisionItems = (revisionsResponse.items as Revision[])
    .map((revision) => mapRevisionToCalendarItem(revision, viewMode))
    .filter((item): item is CalendarItem => Boolean(item));

  const visitItems = (visitsResponse.visits as Visit[])
    .map((visit) => mapVisitToCalendarItem(visit))
    .filter((item): item is CalendarItem => Boolean(item));

  const taskItems = (communicationsResponse.communications as Communication[])
    .map((comm) => mapCommunicationToCalendarItem(comm))
    .filter((item): item is CalendarItem => Boolean(item))
    .filter((item) => item.date >= filters.startDate && item.date <= filters.endDate);

  let items = [...revisionItems, ...visitItems, ...taskItems];
  items = filterByStatus(items, filters.status);
  items = filterByCrew(items, filters.crewId);
  items = filterByCustomerQuery(items, filters.customerQuery);

  items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.timeStart || '').localeCompare(b.timeStart || '');
  });

  return { items };
}
