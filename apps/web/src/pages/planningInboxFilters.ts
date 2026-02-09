import type { CallQueueItem } from '../services/revisionService';

export type TimeFilter = 'overdue' | 'thisWeek' | 'thisMonth';
export type ScheduleFilter = 'hasTerm' | 'noTerm';
export type RouteFilter = 'inRoute' | 'notInRoute';
export type ProblemFilter = 'missingPhone' | 'addressIssue';

export interface InboxFilters {
  time: TimeFilter[];
  schedule: ScheduleFilter[];
  route: RouteFilter[];
  problems: ProblemFilter[];
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  time: ['thisWeek'],
  schedule: [],
  route: [],
  problems: [],
};

export function isScheduledCandidate(item: CallQueueItem): boolean {
  return item.status === 'scheduled' || item.status === 'confirmed';
}

export function hasPhone(item: CallQueueItem): boolean {
  return item.customerPhone !== null && item.customerPhone.trim() !== '';
}

export function hasValidAddress(item: CallQueueItem): boolean {
  return (
    item.customerGeocodeStatus === 'success' &&
    item.customerLat !== null &&
    item.customerLng !== null
  );
}

function matchesTimeGroup(item: CallQueueItem, filters: TimeFilter[]): boolean {
  if (filters.length === 0) return true;

  const matchesOverdue = filters.includes('overdue') && item.daysUntilDue < 0;
  const matchesWeek = filters.includes('thisWeek') && item.daysUntilDue <= 7;
  const matchesMonth = filters.includes('thisMonth') && item.daysUntilDue <= 30;

  return matchesOverdue || matchesWeek || matchesMonth;
}

function matchesScheduleGroup(item: CallQueueItem, filters: ScheduleFilter[]): boolean {
  if (filters.length === 0) return true;

  const scheduled = isScheduledCandidate(item);
  const matchesHas = filters.includes('hasTerm') && scheduled;
  const matchesNo = filters.includes('noTerm') && !scheduled;

  return matchesHas || matchesNo;
}

function matchesRouteGroup(
  item: CallQueueItem,
  filters: RouteFilter[],
  inRouteIds: Set<string>,
): boolean {
  if (filters.length === 0) return true;

  const isInRoute = inRouteIds.has(item.customerId);
  const matchesIn = filters.includes('inRoute') && isInRoute;
  const matchesNotIn = filters.includes('notInRoute') && !isInRoute;

  return matchesIn || matchesNotIn;
}

function matchesProblemGroup(item: CallQueueItem, filters: ProblemFilter[]): boolean {
  if (filters.length === 0) return true;

  const missingPhone = !hasPhone(item);
  const addressIssue = !hasValidAddress(item);

  const matchesPhone = filters.includes('missingPhone') && missingPhone;
  const matchesAddress = filters.includes('addressIssue') && addressIssue;

  return matchesPhone || matchesAddress;
}

export function applyInboxFilters(
  candidates: CallQueueItem[],
  filters: InboxFilters,
  inRouteIds: Set<string>,
): CallQueueItem[] {
  return candidates.filter((item) => {
    return (
      matchesTimeGroup(item, filters.time) &&
      matchesScheduleGroup(item, filters.schedule) &&
      matchesRouteGroup(item, filters.route, inRouteIds) &&
      matchesProblemGroup(item, filters.problems)
    );
  });
}

export function getActiveFilterCount(filters: InboxFilters): number {
  return (
    filters.time.length +
    filters.schedule.length +
    filters.route.length +
    filters.problems.length
  );
}

export function toggleFilter<T extends string>(source: T[], value: T): T[] {
  return source.includes(value)
    ? source.filter((entry) => entry !== value)
    : [...source, value];
}
