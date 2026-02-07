/**
 * Worker management service - handles worker (pracovník) CRUD operations
 * Workers are created by customers and share the customer's data.
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import type { UserPublic, CreateWorkerRequest } from '@shared/auth';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

/**
 * Create a new worker
 */
export async function createWorker(data: CreateWorkerRequest): Promise<UserPublic> {
  const { request } = useNatsStore.getState();
  const req = createRequest(getToken(), data);
  const response = await request<typeof req, NatsResponse<UserPublic>>(
    'sazinka.auth.worker.create',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * List all workers for the current customer
 */
export async function listWorkers(): Promise<UserPublic[]> {
  const { request } = useNatsStore.getState();
  const req = createRequest(getToken(), {});
  const response = await request<typeof req, NatsResponse<UserPublic[]>>(
    'sazinka.auth.worker.list',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Delete a worker
 */
export async function deleteWorker(workerId: string): Promise<boolean> {
  const { request } = useNatsStore.getState();
  const req = createRequest(getToken(), { id: workerId });
  const response = await request<typeof req, NatsResponse<{ deleted: boolean }>>(
    'sazinka.auth.worker.delete',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.deleted;
}
