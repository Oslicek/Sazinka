/**
 * Geometry service - fetch Valhalla route geometry via JetStream job queue.
 *
 * Shared by Planner and PlanningInbox.
 */

import { useNatsStore } from '../stores/natsStore';
import { createRequest, type SuccessResponse, type ErrorResponse } from '@shared/messages';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

export interface GeometryJobSubmitResponse {
  jobId: string;
  message: string;
}

export type GeometryJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'processing'; message: string }
  | { type: 'completed'; coordinates: [number, number][] }
  | { type: 'failed'; error: string };

export interface GeometryJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: GeometryJobStatus;
}

/**
 * Submit a geometry calculation job to the Valhalla JetStream queue.
 * Returns the job ID; subscribe to status updates to get the result.
 */
export async function submitGeometryJob(
  locations: Array<{ lat: number; lng: number }>,
  deps = { request: useNatsStore.getState().request },
): Promise<GeometryJobSubmitResponse> {
  const req = createRequest(TEMP_USER_ID, { locations });

  const response = await deps.request<typeof req, NatsResponse<GeometryJobSubmitResponse>>(
    'sazinka.valhalla.geometry.submit',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to geometry job status updates.
 * Returns an unsubscribe function.
 */
export async function subscribeToGeometryJobStatus(
  jobId: string,
  callback: (update: GeometryJobStatusUpdate) => void,
  deps = { subscribe: useNatsStore.getState().subscribe },
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('subscribe is not available');
  }

  const subject = `sazinka.job.valhalla.geometry.status.${jobId}`;
  return deps.subscribe<GeometryJobStatusUpdate>(subject, callback);
}
