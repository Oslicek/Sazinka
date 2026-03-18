/**
 * Service for handling all import jobs (async background processing)
 */
import type { 
  CustomerImportJobRequest, 
  CustomerImportJobSubmitResponse,
  DeviceImportJobRequest,
  DeviceImportJobSubmitResponse,
  RevisionImportJobRequest,
  RevisionImportJobSubmitResponse,
  CommunicationImportJobRequest,
  CommunicationImportJobSubmitResponse,
  WorkLogImportJobRequest,
  WorkLogImportJobSubmitResponse,
  ZipImportJobRequest,
  ZipImportJobSubmitResponse,
} from '@shared/import';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

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
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): ImportJobServiceDeps {
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

// =============================================================================
// CUSTOMER IMPORT
// =============================================================================

/**
 * Submit a customer import job
 * Returns immediately after the job is queued
 */
export async function submitCustomerImportJob(
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<CustomerImportJobSubmitResponse> {
  const payload: CustomerImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(getToken(), payload);
  
  const response = await deps.request<typeof request, NatsResponse<CustomerImportJobSubmitResponse>>(
    SUBJECTS.customer.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// =============================================================================
// DEVICE IMPORT
// =============================================================================

/**
 * Submit a device import job
 */
export async function submitDeviceImportJob(
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<DeviceImportJobSubmitResponse> {
  const payload: DeviceImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(getToken(), payload);
  
  const response = await deps.request<typeof request, NatsResponse<DeviceImportJobSubmitResponse>>(
    SUBJECTS.device.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// =============================================================================
// REVISION IMPORT
// =============================================================================

/**
 * Submit a revision import job
 */
export async function submitRevisionImportJob(
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<RevisionImportJobSubmitResponse> {
  const payload: RevisionImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(getToken(), payload);
  
  const response = await deps.request<typeof request, NatsResponse<RevisionImportJobSubmitResponse>>(
    SUBJECTS.revision.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// =============================================================================
// COMMUNICATION IMPORT
// =============================================================================

/**
 * Submit a communication import job
 */
export async function submitCommunicationImportJob(
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<CommunicationImportJobSubmitResponse> {
  const payload: CommunicationImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(getToken(), payload);
  
  const response = await deps.request<typeof request, NatsResponse<CommunicationImportJobSubmitResponse>>(
    SUBJECTS.communication.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// =============================================================================
// WORK LOG IMPORT (replaces visit import)
// =============================================================================

/**
 * Submit a work log import job
 */
export async function submitWorkLogImportJob(
  csvContent: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<WorkLogImportJobSubmitResponse> {
  const payload: WorkLogImportJobRequest = {
    csvContent,
    filename,
  };
  
  const request = createRequest(getToken(), payload);
  
  const response = await deps.request<typeof request, NatsResponse<WorkLogImportJobSubmitResponse>>(
    SUBJECTS.visit.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// =============================================================================
// ZIP IMPORT
// =============================================================================

/**
 * Submit a ZIP import job
 * The ZIP file should be base64 encoded
 */
export async function submitZipImportJob(
  zipContentBase64: string,
  filename: string,
  deps: ImportJobServiceDeps = getDefaultDeps()
): Promise<ZipImportJobSubmitResponse> {
  const payload: ZipImportJobRequest = {
    zipContentBase64,
    filename,
  };
  
  const request = createRequest(getToken(), payload);
  
  const response = await deps.request<typeof request, NatsResponse<ZipImportJobSubmitResponse>>(
    SUBJECTS.zip.submit,
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}
