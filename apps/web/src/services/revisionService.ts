import type { Revision } from '@shared/revision';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

// Re-export types
export type { Revision };

/**
 * Dependencies for revision service (for testing)
 */
export interface RevisionServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): RevisionServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

/**
 * Response type that can be either success or error
 */
type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Type guard to check if response is an error
 */
function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

// ============================================================================
// Request Types
// ============================================================================

export interface CreateRevisionRequest {
  deviceId: string;
  customerId: string;
  dueDate: string;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  findings?: string;
}

export interface UpdateRevisionRequest {
  id: string;
  status?: string;
  dueDate?: string;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  durationMinutes?: number;
}

export interface CompleteRevisionRequest {
  id: string;
  result: string; // 'passed' | 'failed' | 'conditional'
  findings?: string;
  durationMinutes?: number;
}

export interface ListRevisionsFilters {
  customerId?: string;
  deviceId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  /** Which date field to filter: "due" (default) or "scheduled" */
  dateType?: 'due' | 'scheduled';
  limit?: number;
  offset?: number;
}

// ============================================================================
// Response Types
// ============================================================================

export interface RevisionListResponse {
  items: Revision[];
  total: number;
}

export interface UpcomingRevisionsResponse {
  overdue: Revision[];
  dueSoon: Revision[];
}

export interface RevisionStats {
  overdue: number;
  dueThisWeek: number;
  scheduledToday: number;
  completedThisMonth: number;
}

export interface RevisionSuggestion {
  id: string;
  deviceId: string;
  customerId: string;
  userId: string;
  status: string;
  dueDate: string;
  scheduledDate: string | null;
  scheduledTimeStart: string | null;
  scheduledTimeEnd: string | null;
  customerName: string;
  customerStreet: string;
  customerCity: string;
  customerLat: number | null;
  customerLng: number | null;
  priorityScore: number;
  daysUntilDue: number;
  priorityReason: string;
}

export interface SuggestRevisionsRequest {
  date: string;
  maxCount?: number;
  excludeIds?: string[];
}

export interface SuggestRevisionsResponse {
  suggestions: RevisionSuggestion[];
  totalCandidates: number;
}

// ============================================================================
// Call Queue Types (Phase 6A)
// ============================================================================

export interface CallQueueRequest {
  area?: string;
  deviceType?: string;
  priorityFilter?: 'all' | 'overdue' | 'due_soon' | 'upcoming';
  limit?: number;
  offset?: number;
}

export interface CallQueueItem {
  id: string;
  deviceId: string;
  customerId: string;
  userId: string;
  status: string;
  dueDate: string;
  snoozeUntil: string | null;
  snoozeReason: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerStreet: string;
  customerCity: string;
  customerPostalCode: string;
  customerLat: number | null;
  customerLng: number | null;
  deviceName: string | null;
  deviceType: string;
  daysUntilDue: number;
  priority: 'overdue' | 'due_this_week' | 'due_soon' | 'upcoming';
  lastContactAt: string | null;
  contactAttempts: number;
}

export interface CallQueueResponse {
  items: CallQueueItem[];
  total: number;
  overdueCount: number;
  dueSoonCount: number;
}

export interface SnoozeRevisionRequest {
  id: string;
  snoozeUntil: string;
  reason?: string;
}

export interface ScheduleRevisionRequest {
  id: string;
  scheduledDate: string;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  assignedVehicleId?: string;
  durationMinutes?: number;
  notes?: string;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new revision
 */
export async function createRevision(
  userId: string,
  data: CreateRevisionRequest,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<Revision> {
  const request = createRequest(userId, data);

  const response = await deps.request<typeof request, NatsResponse<Revision>>(
    'sazinka.revision.create',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * List revisions with optional filters
 */
export async function listRevisions(
  userId: string,
  filters: ListRevisionsFilters = {},
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<RevisionListResponse> {
  const request = createRequest(userId, filters);

  const response = await deps.request<typeof request, NatsResponse<RevisionListResponse>>(
    'sazinka.revision.list',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get a single revision by ID
 */
export async function getRevision(
  userId: string,
  revisionId: string,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<Revision> {
  const request = createRequest(userId, { id: revisionId });

  const response = await deps.request<typeof request, NatsResponse<Revision>>(
    'sazinka.revision.get',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update a revision
 */
export async function updateRevision(
  userId: string,
  data: UpdateRevisionRequest,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<Revision> {
  const request = createRequest(userId, data);

  const response = await deps.request<typeof request, NatsResponse<Revision>>(
    'sazinka.revision.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Complete a revision with result and findings
 */
export async function completeRevision(
  userId: string,
  data: CompleteRevisionRequest,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<Revision> {
  const request = createRequest(userId, data);

  const response = await deps.request<typeof request, NatsResponse<Revision>>(
    'sazinka.revision.complete',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Delete a revision
 */
export async function deleteRevision(
  userId: string,
  revisionId: string,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<boolean> {
  const request = createRequest(userId, { id: revisionId });

  const response = await deps.request<typeof request, NatsResponse<{ deleted: boolean }>>(
    'sazinka.revision.delete',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.deleted;
}

/**
 * Get upcoming revisions (overdue + due soon)
 */
export async function getUpcomingRevisions(
  userId: string,
  daysAhead: number = 30,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<UpcomingRevisionsResponse> {
  const request = createRequest(userId, { daysAhead });

  const response = await deps.request<typeof request, NatsResponse<UpcomingRevisionsResponse>>(
    'sazinka.revision.upcoming',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get revision statistics for dashboard
 */
export async function getRevisionStats(
  userId: string,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<RevisionStats> {
  const request = createRequest(userId, {});

  const response = await deps.request<typeof request, NatsResponse<RevisionStats>>(
    'sazinka.revision.stats',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get suggested revisions for route planning
 * Returns prioritized list based on urgency (overdue > due soon > upcoming)
 */
export async function getSuggestedRevisions(
  userId: string,
  date: string,
  maxCount: number = 50,
  excludeIds: string[] = [],
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<SuggestRevisionsResponse> {
  const payload: SuggestRevisionsRequest = {
    date,
    maxCount,
    excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
  };
  const request = createRequest(userId, payload);

  const response = await deps.request<typeof request, NatsResponse<SuggestRevisionsResponse>>(
    'sazinka.revision.suggest',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ============================================================================
// Call Queue Service Functions (Phase 6A)
// ============================================================================

/**
 * Get the call queue - revisions needing customer contact
 */
export async function getCallQueue(
  userId: string,
  filters: CallQueueRequest = {},
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<CallQueueResponse> {
  const request = createRequest(userId, filters);

  const response = await deps.request<typeof request, NatsResponse<CallQueueResponse>>(
    'sazinka.revision.queue',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Snooze a revision - postpone contact until a future date
 */
export async function snoozeRevision(
  userId: string,
  data: SnoozeRevisionRequest,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<Revision> {
  const request = createRequest(userId, data);

  const response = await deps.request<typeof request, NatsResponse<Revision>>(
    'sazinka.revision.snooze',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Schedule a revision - set date, time window, and optionally vehicle
 */
export async function scheduleRevision(
  userId: string,
  data: ScheduleRevisionRequest,
  deps: RevisionServiceDeps = getDefaultDeps()
): Promise<Revision> {
  const request = createRequest(userId, data);

  const response = await deps.request<typeof request, NatsResponse<Revision>>(
    'sazinka.revision.schedule',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}
