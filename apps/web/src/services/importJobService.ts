/**
 * Service for handling all import jobs (async background processing)
 */
import type { 
  CustomerImportJobRequest, 
  CustomerImportJobStatusUpdate,
  CustomerImportJobSubmitResponse,
  DeviceImportJobRequest,
  DeviceImportJobStatusUpdate,
  DeviceImportJobSubmitResponse,
  RevisionImportJobRequest,
  RevisionImportJobStatusUpdate,
  RevisionImportJobSubmitResponse,
  CommunicationImportJobRequest,
  CommunicationImportJobStatusUpdate,
  CommunicationImportJobSubmitResponse,
  VisitImportJobRequest,
  VisitImportJobStatusUpdate,
  VisitImportJobSubmitResponse,
  ZipImportJobRequest,
  ZipImportJobStatusUpdate,
  ZipImportJobSubmitResponse,
} from '@shared/import';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

// NATS subjects for all import types
const SUBJECTS = {
  customer: {
    submit: 'sazinka.import.customer.submit',
    status: 'sazinka.job.import.customer.status',
  },
  device: {
    submit: 'sazinka.import.device.submit',
    status: 'sazinka.job.import.device.status',
  },
  revision: {
    submit: 'sazinka.import.revision.submit',
    status: 'sazinka.job.import.revision.status',
  },
  communication: {
    submit: 'sazinka.import.communication.submit',
    status: 'sazinka.job.import.communication.status',
  },
  visit: {
    submit: 'sazinka.import.visit.submit',
    status: 'sazinka.job.import.visit.status',
  },
  zip: {
    submit: 'sazinka.import.zip.submit',
    status: 'sazinka.job.import.zip.status',
  },
} as const;

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

// =============================================================================
// CUSTOMER IMPORT
// =============================================================================

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
    SUBJECTS.customer.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific customer import job
 */
export async function subscribeToCustomerImportJobStatus(
  jobId: string,
  callback: (update: CustomerImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${SUBJECTS.customer.status}.${jobId}`;
  return deps.subscribe<CustomerImportJobStatusUpdate>(subject, callback);
}

// =============================================================================
// DEVICE IMPORT
// =============================================================================

/**
 * Submit a device import job
 */
export async function submitDeviceImportJob(
  userId: string,
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<DeviceImportJobSubmitResponse> {
  const payload: DeviceImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(userId, payload);
  
  const response = await deps.request<typeof request, NatsResponse<DeviceImportJobSubmitResponse>>(
    SUBJECTS.device.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific device import job
 */
export async function subscribeToDeviceImportJobStatus(
  jobId: string,
  callback: (update: DeviceImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${SUBJECTS.device.status}.${jobId}`;
  return deps.subscribe<DeviceImportJobStatusUpdate>(subject, callback);
}

// =============================================================================
// REVISION IMPORT
// =============================================================================

/**
 * Submit a revision import job
 */
export async function submitRevisionImportJob(
  userId: string,
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<RevisionImportJobSubmitResponse> {
  const payload: RevisionImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(userId, payload);
  
  const response = await deps.request<typeof request, NatsResponse<RevisionImportJobSubmitResponse>>(
    SUBJECTS.revision.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific revision import job
 */
export async function subscribeToRevisionImportJobStatus(
  jobId: string,
  callback: (update: RevisionImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${SUBJECTS.revision.status}.${jobId}`;
  return deps.subscribe<RevisionImportJobStatusUpdate>(subject, callback);
}

// =============================================================================
// COMMUNICATION IMPORT
// =============================================================================

/**
 * Submit a communication import job
 */
export async function submitCommunicationImportJob(
  userId: string,
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<CommunicationImportJobSubmitResponse> {
  const payload: CommunicationImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(userId, payload);
  
  const response = await deps.request<typeof request, NatsResponse<CommunicationImportJobSubmitResponse>>(
    SUBJECTS.communication.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific communication import job
 */
export async function subscribeToCommunicationImportJobStatus(
  jobId: string,
  callback: (update: CommunicationImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${SUBJECTS.communication.status}.${jobId}`;
  return deps.subscribe<CommunicationImportJobStatusUpdate>(subject, callback);
}

// =============================================================================
// VISIT IMPORT
// =============================================================================

/**
 * Submit a visit import job
 */
export async function submitVisitImportJob(
  userId: string,
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<VisitImportJobSubmitResponse> {
  const payload: VisitImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(userId, payload);
  
  const response = await deps.request<typeof request, NatsResponse<VisitImportJobSubmitResponse>>(
    SUBJECTS.visit.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific visit import job
 */
export async function subscribeToVisitImportJobStatus(
  jobId: string,
  callback: (update: VisitImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${SUBJECTS.visit.status}.${jobId}`;
  return deps.subscribe<VisitImportJobStatusUpdate>(subject, callback);
}

// =============================================================================
// ZIP IMPORT
// =============================================================================

/**
 * Submit a ZIP import job
 * The ZIP file should be base64 encoded
 */
export async function submitZipImportJob(
  userId: string,
  zipContentBase64: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<ZipImportJobSubmitResponse> {
  const payload: ZipImportJobRequest = {
    zipContentBase64,
    filename,
  };
  
  const request = createRequest(userId, payload);
  
  const response = await deps.request<typeof request, NatsResponse<ZipImportJobSubmitResponse>>(
    SUBJECTS.zip.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Subscribe to status updates for a specific ZIP import job
 */
export async function subscribeToZipImportJobStatus(
  jobId: string,
  callback: (update: ZipImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  const subject = `${SUBJECTS.zip.status}.${jobId}`;
  return deps.subscribe<ZipImportJobStatusUpdate>(subject, callback);
}

// =============================================================================
// LEGACY ALIASES (for backward compatibility)
// =============================================================================

/**
 * @deprecated Use subscribeToCustomerImportJobStatus instead
 */
export const subscribeToImportJobStatus = subscribeToCustomerImportJobStatus;

/**
 * Subscribe to all import job statuses (all types)
 * Useful for global job monitoring
 * Returns an array of unsubscribe functions
 */
export async function subscribeToAllImportJobStatuses(
  callback: (update: CustomerImportJobStatusUpdate | DeviceImportJobStatusUpdate | RevisionImportJobStatusUpdate | CommunicationImportJobStatusUpdate | VisitImportJobStatusUpdate | ZipImportJobStatusUpdate) => void,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<(() => void)[]> {
  if (!deps.subscribe) {
    throw new Error('Subscribe function not available');
  }
  
  // Subscribe to all job status updates for all types
  const unsubscribeFunctions: (() => void)[] = [];
  
  for (const type of Object.keys(SUBJECTS) as (keyof typeof SUBJECTS)[]) {
    const unsub = await deps.subscribe(`${SUBJECTS[type].status}.*`, callback);
    unsubscribeFunctions.push(unsub);
  }
  
  return unsubscribeFunctions;
}

// Export subjects for use in other modules
export { SUBJECTS as IMPORT_JOB_SUBJECTS };
