/**
 * Job management service
 * 
 * Provides APIs for managing background jobs:
 * - List active/recent jobs
 * - Cancel jobs
 * - Retry failed jobs
 */

import { useNatsStore } from '../stores/natsStore';
import { createRequest, type SuccessResponse, type ErrorResponse } from '@shared/messages';
import type { JobType, JobStatusUpdate } from '../types/jobStatus';
import { getToken } from '@/utils/auth';

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

/** Job history entry from the backend */
export interface JobHistoryEntry {
  id: string;
  jobType: string;
  status: 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error: string | null;
  details: string | null;
}

/** Response from jobs.history endpoint */
export interface JobHistoryResponse {
  jobs: JobHistoryEntry[];
  total: number;
}

/** Response from job cancel/retry */
export interface JobActionResponse {
  success: boolean;
  message: string;
  jobId: string;
}

/** Request for job history */
export interface ListJobHistoryRequest {
  limit?: number;
  jobType?: string;
  status?: string;
}

/** List job history */
export async function listJobHistory(
  options: ListJobHistoryRequest = {}
): Promise<JobHistoryResponse> {
  const { request } = useNatsStore.getState();
  
  const req = createRequest(getToken(), options);
  const response = await request<typeof req, NatsResponse<JobHistoryResponse>>(
    'sazinka.jobs.history',
    req
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

/** Cancel an active job */
export async function cancelJob(jobId: string, jobType: JobType): Promise<JobActionResponse> {
  const { request } = useNatsStore.getState();
  
  const req = createRequest(getToken(), { jobId, jobType });
  const response = await request<typeof req, NatsResponse<JobActionResponse>>(
    'sazinka.jobs.cancel',
    req
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

/** Retry a failed job */
export async function retryJob(jobId: string, jobType: JobType): Promise<JobActionResponse> {
  const { request } = useNatsStore.getState();
  
  const req = createRequest(getToken(), { jobId, jobType });
  const response = await request<typeof req, NatsResponse<JobActionResponse>>(
    'sazinka.jobs.retry',
    req
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

/** Subscribe to all job status updates for a user */
export async function subscribeToAllJobUpdates(
  userId: string,
  onUpdate: (jobType: JobType, update: JobStatusUpdate) => void
): Promise<() => void> {
  const { subscribe } = useNatsStore.getState();
  
  // Subscribe to wildcard pattern for all job types
  // Note: This requires the backend to publish to this subject
  const unsubscribe = await subscribe<JobStatusUpdate & { jobType: JobType }>(
    `sazinka.user.${userId}.jobs.>`,
    (update) => {
      // Extract job type from the update or subject
      const jobType = (update as any).jobType || 'unknown';
      onUpdate(jobType as JobType, update);
    }
  );
  
  return unsubscribe;
}
