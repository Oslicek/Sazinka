import { createRequest, type ErrorResponse, type SuccessResponse } from '@shared/messages';
import { useNatsStore } from '@/stores/natsStore';
import { getToken } from '@/utils/auth';

export type ExportPlusFile = 'customers' | 'devices' | 'revisions' | 'communications' | 'work_log' | 'routes';
export type ExportScope = 'customer_only' | 'all_workers_combined' | 'all_workers_split' | 'single_worker';

export interface ExportPlusFilters {
  dateFrom?: string;
  dateTo?: string;
  revisionStatuses?: string[];
  visitStatuses?: string[];
  routeStatuses?: string[];
  crewIds?: string[];
  depotIds?: string[];
}

export interface ExportPlusRequest {
  scope: ExportScope;
  selectedFiles: ExportPlusFile[];
  filters: ExportPlusFilters;
  selectedWorkerId?: string;
  userTimeZone?: string;
  userTimeZoneOffsetMinutes?: number;
}

export interface ExportJobSubmitResponse {
  jobId: string;
  position: number;
  estimatedWaitSeconds: number;
  message: string;
}

export interface ExportJobResult {
  jobId: string;
  fileName?: string;
  fileSizeBytes?: number;
  rowCount?: number;
  downloadReady?: boolean;
}

export type ExportJobStatus =
  | { type: 'queued'; position?: number }
  | { type: 'processing'; progress?: number; message?: string }
  | { type: 'completed'; result?: ExportJobResult }
  | { type: 'failed'; error: string };

export interface ExportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: ExportJobStatus;
}

export interface ExportDownloadResponse {
  filename: string;
  contentType: string;
  fileBase64: string;
  sizeBytes: number;
}

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse<T>(response: NatsResponse<T>): response is ErrorResponse {
  return 'error' in response;
}

export async function submitExportJob(requestPayload: ExportPlusRequest): Promise<ExportJobSubmitResponse> {
  const { request } = useNatsStore.getState();
  const req = createRequest(getToken(), requestPayload);
  const response = await request<typeof req, NatsResponse<ExportJobSubmitResponse>>('sazinka.export.submit', req);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  return response.payload;
}

export async function subscribeExportJob(
  jobId: string,
  onUpdate: (update: ExportJobStatusUpdate) => void
): Promise<() => void> {
  const { subscribe } = useNatsStore.getState();
  return subscribe<ExportJobStatusUpdate>(`sazinka.job.export.status.${jobId}`, onUpdate);
}

export async function downloadExportJob(jobId: string): Promise<{ filename: string; blob: Blob }> {
  const { request } = useNatsStore.getState();
  const req = createRequest(getToken(), {
    jobId,
    userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userTimeZoneOffsetMinutes: new Date().getTimezoneOffset(),
  });
  const response = await request<typeof req, NatsResponse<ExportDownloadResponse>>(
    'sazinka.export.download',
    req,
    60000
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  const payload = response.payload;
  const bytes = Uint8Array.from(atob(payload.fileBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: payload.contentType || 'application/zip' });
  return { filename: payload.filename, blob };
}
