import type { Revision } from '@shared/revision';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

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
