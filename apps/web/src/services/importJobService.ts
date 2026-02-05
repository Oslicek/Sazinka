/**
 * Service for handling customer import jobs (async background processing)
 */
import type { 
  CustomerImportJobRequest, 
  CustomerImportJobStatusUpdate,
  CustomerImportJobSubmitResponse 
} from '@shared/import';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

// NATS subjects
const SUBMIT_SUBJECT = 'sazinka.import.customer.submit';
const STATUS_SUBJECT_PREFIX = 'sazinka.job.import.status';

/**
 * Dependencies for import job service
 */
export interface ImportJobServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
  subscribe?: <T>(subject: string, callback: (msg: T) => void) => Promise<() => void>;
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): ImportJobServiceDeps {
  return {
    request: useNatsStore.getState().request,
    subscribe: useNatsStore.getState().subscribe,
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

/**
 * Submit a customer import job
 * Returns immediately after the job is queued
 */
export async function submitCustomerImportJob(
  userId: string,
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<CustomerImportJobSubmitResponse> {
  const payload: CustomerImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(userId, payload);
  
  const response = await deps.request<typeof request, NatsResponse<CustomerImportJobSubmitResponse>>(
    SUBMIT_SUBJECT,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific import job
 * Returns an unsubscribe function
 */
export async function subscribeToImportJobStatus(
  jobId: string,
  callback: (update: CustomerImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${STATUS_SUBJECT_PREFIX}.${jobId}`;
  
  return deps.subscribe<CustomerImportJobStatusUpdate>(subject, callback);
}

/**
 * Subscribe to status updates for all import jobs
 * Useful for global job monitoring
 */
export async function subscribeToAllImportJobStatuses(
  callback: (update: CustomerImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  // Subscribe to all job status updates using wildcard
  const subject = `${STATUS_SUBJECT_PREFIX}.*`;
  
  return deps.subscribe<CustomerImportJobStatusUpdate>(subject, callback);
}
