/**
 * Import batch services for sending parsed data to backend
 */

import { useNatsStore } from '../../stores/natsStore';
import { createRequest } from '@shared/messages';
import type {
  ImportDeviceRequest,
  ImportRevisionRequest,
  ImportCommunicationRequest,
  ImportWorkLogRequest,
  ImportBatchResponse,
} from '@shared/import';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

interface NatsResponse<T> {
  payload: T;
}

/**
 * Send batch of devices to backend
 */
export async function importDevicesBatch(
  devices: ImportDeviceRequest[]
): Promise<ImportBatchResponse> {
  const { request } = useNatsStore.getState();

  const req = createRequest(USER_ID, { devices });
  const response = await request<typeof req, NatsResponse<ImportBatchResponse>>(
    'sazinka.import.device',
    req
  );

  return response.payload;
}

/**
 * Send batch of revisions to backend
 */
export async function importRevisionsBatch(
  revisions: ImportRevisionRequest[]
): Promise<ImportBatchResponse> {
  const { request } = useNatsStore.getState();

  const req = createRequest(USER_ID, { revisions });
  const response = await request<typeof req, NatsResponse<ImportBatchResponse>>(
    'sazinka.import.revision',
    req
  );

  return response.payload;
}

/**
 * Send batch of communications to backend
 */
export async function importCommunicationsBatch(
  communications: ImportCommunicationRequest[]
): Promise<ImportBatchResponse> {
  const { request } = useNatsStore.getState();

  const req = createRequest(USER_ID, { communications });
  const response = await request<typeof req, NatsResponse<ImportBatchResponse>>(
    'sazinka.import.communication',
    req
  );

  return response.payload;
}

/**
 * Send batch of work log entries to backend
 */
export async function importWorkLogBatch(
  entries: ImportWorkLogRequest[]
): Promise<ImportBatchResponse> {
  const { request } = useNatsStore.getState();

  const req = createRequest(USER_ID, { entries });
  const response = await request<typeof req, NatsResponse<ImportBatchResponse>>(
    'sazinka.import.worklog',
    req
  );

  return response.payload;
}
