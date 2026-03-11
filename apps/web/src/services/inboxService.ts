import type { InboxItem, InboxRequest, InboxResponse } from '@shared/inbox';
import type {
  PlannedAction,
  CreatePlannedActionRequest,
  UpdatePlannedActionRequest,
  PlannedActionListResponse,
  ListPlannedActionsRequest,
} from '@shared/plannedAction';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

export type {
  InboxItem,
  InboxRequest,
  InboxResponse,
  PlannedAction,
  CreatePlannedActionRequest,
  UpdatePlannedActionRequest,
};

// ============================================================================
// Dependency injection (for testing)
// ============================================================================

export interface InboxServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

function getDefaultDeps(): InboxServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

// ============================================================================
// Inbox
// ============================================================================

/**
 * Query the customer-centric planning inbox.
 * Replaces the old `getCallQueue` / `sazinka.revision.queue` call.
 */
export async function getInbox(
  req: InboxRequest = {},
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<InboxResponse> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<InboxResponse>>(
    'sazinka.inbox.query',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

// ============================================================================
// Planned actions
// ============================================================================

/**
 * Create a new planned action for a customer.
 */
export async function createPlannedAction(
  req: CreatePlannedActionRequest,
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<PlannedAction> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<PlannedAction>>(
    'sazinka.planned_action.create',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

/**
 * List planned actions, optionally filtered by customer or status.
 */
export async function listPlannedActions(
  req: ListPlannedActionsRequest = {},
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<PlannedActionListResponse> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<PlannedActionListResponse>>(
    'sazinka.planned_action.list',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

/**
 * Update a planned action (status, due date, note, snooze).
 */
export async function updatePlannedAction(
  req: UpdatePlannedActionRequest,
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<PlannedAction> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<PlannedAction>>(
    'sazinka.planned_action.update',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

/**
 * Cancel a planned action.
 */
export async function cancelPlannedAction(
  actionId: string,
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<PlannedAction> {
  const request = createRequest(getToken(), actionId);
  const response = await deps.request<typeof request, NatsResponse<PlannedAction>>(
    'sazinka.planned_action.cancel',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

/**
 * Complete a planned action.
 */
export async function completePlannedAction(
  actionId: string,
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<PlannedAction> {
  const request = createRequest(getToken(), actionId);
  const response = await deps.request<typeof request, NatsResponse<PlannedAction>>(
    'sazinka.planned_action.complete',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

// ============================================================================
// Customer lifecycle
// ============================================================================

/**
 * Mark a customer as abandoned (removes them from the inbox).
 */
export async function abandonCustomer(
  customerId: string,
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<void> {
  const request = createRequest(getToken(), customerId);
  const response = await deps.request<typeof request, NatsResponse<unknown>>(
    'sazinka.customer.abandon',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
}

/**
 * Restore an abandoned customer to the inbox.
 */
export async function unabandonCustomer(
  customerId: string,
  deps: InboxServiceDeps = getDefaultDeps()
): Promise<void> {
  const request = createRequest(getToken(), customerId);
  const response = await deps.request<typeof request, NatsResponse<unknown>>(
    'sazinka.customer.unabandon',
    request
  );
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
}
