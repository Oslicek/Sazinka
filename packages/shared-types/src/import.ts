/**
 * Import types for all entities
 * See PROJECT_IMPORT.MD for full specification
 */

// Import and re-export common import types from customer.ts
import type { ImportReport } from './customer';
export type { ImportIssue, ImportIssueLevel, ImportIssueCode, ImportReport, ImportIssueSummary } from './customer';

// =============================================================================
// IMPORT JOB TYPES (for async background processing)
// =============================================================================

/**
 * Request to submit a customer import job
 */
export interface CustomerImportJobRequest {
  csvContent: string;
  filename: string;
}

/**
 * Status of a customer import job
 */
export type CustomerImportJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'parsing'; progress: number }
  | { type: 'importing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; report: ImportReport }
  | { type: 'failed'; error: string };

/**
 * Status update message for import job
 */
export interface CustomerImportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: CustomerImportJobStatus;
}

/**
 * Response when submitting an import job
 */
export interface CustomerImportJobSubmitResponse {
  jobId: string;
  message: string;
}

// =============================================================================
// GEOCODE JOB TYPES (for async background processing)
// =============================================================================

/**
 * Status of a geocoding batch job
 */
export type GeocodeJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'processing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; failedAddresses: string[] }
  | { type: 'failed'; error: string };

/**
 * Status update message for geocode job
 */
export interface GeocodeJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: GeocodeJobStatus;
}

// =============================================================================
// DEVICE IMPORT JOB TYPES
// =============================================================================

export interface DeviceImportJobRequest {
  csvContent: string;
  filename: string;
}

export type DeviceImportJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'parsing'; progress: number }
  | { type: 'importing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; report: ImportReport }
  | { type: 'failed'; error: string };

export interface DeviceImportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: DeviceImportJobStatus;
}

export interface DeviceImportJobSubmitResponse {
  jobId: string;
  message: string;
}

// =============================================================================
// REVISION IMPORT JOB TYPES
// =============================================================================

export interface RevisionImportJobRequest {
  csvContent: string;
  filename: string;
}

export type RevisionImportJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'parsing'; progress: number }
  | { type: 'importing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; report: ImportReport }
  | { type: 'failed'; error: string };

export interface RevisionImportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: RevisionImportJobStatus;
}

export interface RevisionImportJobSubmitResponse {
  jobId: string;
  message: string;
}

// =============================================================================
// COMMUNICATION IMPORT JOB TYPES
// =============================================================================

export interface CommunicationImportJobRequest {
  csvContent: string;
  filename: string;
}

export type CommunicationImportJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'parsing'; progress: number }
  | { type: 'importing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; report: ImportReport }
  | { type: 'failed'; error: string };

export interface CommunicationImportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: CommunicationImportJobStatus;
}

export interface CommunicationImportJobSubmitResponse {
  jobId: string;
  message: string;
}

// =============================================================================
// WORK LOG IMPORT JOB TYPES (replaces visit import)
// =============================================================================

export interface WorkLogImportJobRequest {
  csvContent: string;
  filename: string;
}

export type WorkLogImportJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'parsing'; progress: number }
  | { type: 'importing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; report: ImportReport }
  | { type: 'failed'; error: string };

export interface WorkLogImportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: WorkLogImportJobStatus;
}

export interface WorkLogImportJobSubmitResponse {
  jobId: string;
  message: string;
}

// =============================================================================
// ZIP IMPORT JOB TYPES
// =============================================================================

export type ZipImportFileType = 'customers' | 'devices' | 'revisions' | 'communications' | 'work_log';

export interface ZipImportFileInfo {
  filename: string;
  type: ZipImportFileType;
  size: number;
}

export interface ZipImportJobRequest {
  /** Base64 encoded ZIP content */
  zipContentBase64: string;
  filename: string;
}

export type ZipImportJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'extracting'; progress: number }
  | { type: 'analyzing'; files: ZipImportFileInfo[] }
  | { 
      type: 'importing'; 
      currentFile: string;
      currentFileType: ZipImportFileType;
      fileProgress: number;
      totalFiles: number;
      completedFiles: number;
    }
  | { 
      type: 'completed'; 
      totalFiles: number;
      results: Array<{
        filename: string;
        type: ZipImportFileType;
        succeeded: number;
        failed: number;
        report: ImportReport;
      }>;
    }
  | { type: 'failed'; error: string };

export interface ZipImportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: ZipImportJobStatus;
}

export interface ZipImportJobSubmitResponse {
  jobId: string;
  message: string;
  detectedFiles: ZipImportFileInfo[];
}

// =============================================================================
// CSV ROW TYPES
// =============================================================================

/**
 * Raw CSV row for device import
 */
export interface CsvDeviceRow {
  customer_ref?: string;
  device_type?: string;
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  installation_date?: string;
  revision_interval_months?: string;
  notes?: string;
}

/**
 * Raw CSV row for revision import
 */
export interface CsvRevisionRow {
  device_ref?: string;
  customer_ref?: string;
  due_date?: string;
  status?: string;
  scheduled_date?: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  completed_at?: string;
  duration_minutes?: string;
  result?: string;
  findings?: string;
}

/**
 * Raw CSV row for communication import
 */
export interface CsvCommunicationRow {
  customer_ref?: string;
  date?: string;
  comm_type?: string;
  direction?: string;
  subject?: string;
  content?: string;
  contact_name?: string;
  contact_phone?: string;
  duration_minutes?: string;
}

/**
 * Raw CSV row for work log import
 */
export interface CsvWorkLogRow {
  customer_ref?: string;
  scheduled_date?: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  device_ref?: string;
  work_type?: string;
  status?: string;
  result?: string;
  duration_minutes?: string;
  result_notes?: string;
  findings?: string;
  requires_follow_up?: string;
  follow_up_reason?: string;
}

// =============================================================================
// IMPORT REQUEST/RESPONSE TYPES
// =============================================================================

export type ImportEntityType = 'customer' | 'device' | 'revision' | 'communication' | 'work_log';

/**
 * Batch import request for devices
 */
export interface ImportDeviceRequest {
  customerRef: string;
  deviceType: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  revisionIntervalMonths: number;
  notes?: string;
}

export interface ImportDeviceBatchRequest {
  devices: ImportDeviceRequest[];
}

/**
 * Batch import request for revisions
 */
export interface ImportRevisionRequest {
  deviceRef: string;
  customerRef: string;
  dueDate: string;
  status?: string;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  completedAt?: string;
  durationMinutes?: number;
  result?: string;
  findings?: string;
}

export interface ImportRevisionBatchRequest {
  revisions: ImportRevisionRequest[];
}

/**
 * Batch import request for communications
 */
export interface ImportCommunicationRequest {
  customerRef: string;
  date: string;
  commType: string;
  direction: string;
  subject?: string;
  content: string;
  contactName?: string;
  contactPhone?: string;
  durationMinutes?: number;
}

export interface ImportCommunicationBatchRequest {
  communications: ImportCommunicationRequest[];
}

/**
 * Batch import request for work log entries
 * Rows with same customerRef + scheduledDate are grouped into one visit
 */
export interface ImportWorkLogRequest {
  customerRef: string;
  scheduledDate: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  deviceRef?: string;
  workType: string;
  status?: string;
  result?: string;
  durationMinutes?: number;
  resultNotes?: string;
  findings?: string;
  requiresFollowUp?: boolean;
  followUpReason?: string;
}

export interface ImportWorkLogBatchRequest {
  entries: ImportWorkLogRequest[];
}

/**
 * Generic batch import response
 */
export interface ImportBatchResponse {
  importedCount: number;
  updatedCount: number;
  errors: Array<{
    rowNumber: number;
    field: string;
    message: string;
    originalValue?: string;
  }>;
}

// =============================================================================
// ALIASES FOR NORMALIZATION
// =============================================================================

export const DEVICE_TYPE_ALIASES: Record<string, string> = {
  // Czech aliases
  'kotel': 'gas_boiler',
  'plynový kotel': 'gas_boiler',
  'plynovy kotel': 'gas_boiler',
  'ohřívač': 'gas_water_heater',
  'ohrivac': 'gas_water_heater',
  'bojler': 'gas_water_heater',
  'komín': 'chimney',
  'komin': 'chimney',
  'kouřovod': 'chimney',
  'kourovod': 'chimney',
  'krb': 'fireplace',
  'krbová vložka': 'fireplace',
  'krbova vlozka': 'fireplace',
  'sporák': 'gas_stove',
  'sporak': 'gas_stove',
  'plynový sporák': 'gas_stove',
  'plynovy sporak': 'gas_stove',
  'jiné': 'other',
  'jine': 'other',
  'ostatní': 'other',
  'ostatni': 'other',
  // English values (passthrough)
  'gas_boiler': 'gas_boiler',
  'gas_water_heater': 'gas_water_heater',
  'chimney': 'chimney',
  'fireplace': 'fireplace',
  'gas_stove': 'gas_stove',
  'other': 'other',
};

export const REVISION_STATUS_ALIASES: Record<string, string> = {
  'nadcházející': 'upcoming',
  'plánovaná': 'upcoming',
  'nadchazejici': 'upcoming',
  'budoucí': 'upcoming',
  'budouci': 'upcoming',
  'naplánováno': 'scheduled',
  'naplanovano': 'scheduled',
  'plánováno': 'scheduled',
  'planovano': 'scheduled',
  'potvrzeno': 'confirmed',
  'dokončeno': 'completed',
  'dokonceno': 'completed',
  'hotovo': 'completed',
  'provedeno': 'completed',
  'zrušeno': 'cancelled',
  'zruseno': 'cancelled',
  'storno': 'cancelled',
  // English passthrough
  'upcoming': 'upcoming',
  'scheduled': 'scheduled',
  'confirmed': 'confirmed',
  'completed': 'completed',
  'cancelled': 'cancelled',
};

export const REVISION_RESULT_ALIASES: Record<string, string> = {
  'ok': 'passed',
  'v pořádku': 'passed',
  'v poradku': 'passed',
  'bez závad': 'passed',
  'bez zavad': 'passed',
  's výhradami': 'conditional',
  's vyhradami': 'conditional',
  'podmíněně': 'conditional',
  'podminene': 'conditional',
  'nevyhovělo': 'failed',
  'nevyhovelo': 'failed',
  'závada': 'failed',
  'zavada': 'failed',
  'nok': 'failed',
  // English passthrough
  'passed': 'passed',
  'conditional': 'conditional',
  'failed': 'failed',
};

export const COMMUNICATION_TYPE_ALIASES: Record<string, string> = {
  'hovor': 'call',
  'telefon': 'call',
  'telefonát': 'call',
  'telefonat': 'call',
  'email': 'email_sent',
  'mail': 'email_sent',
  'odeslaný email': 'email_sent',
  'odeslany email': 'email_sent',
  'přijatý email': 'email_received',
  'prijaty email': 'email_received',
  'příchozí email': 'email_received',
  'prichozi email': 'email_received',
  'poznámka': 'note',
  'poznamka': 'note',
  'záznam': 'note',
  'zaznam': 'note',
  // English passthrough
  'call': 'call',
  'email_sent': 'email_sent',
  'email_received': 'email_received',
  'note': 'note',
  'sms': 'sms',
};

export const COMMUNICATION_DIRECTION_ALIASES: Record<string, string> = {
  'odchozí': 'outbound',
  'odchozi': 'outbound',
  'ven': 'outbound',
  'out': 'outbound',
  'příchozí': 'inbound',
  'prichozi': 'inbound',
  'dovnitř': 'inbound',
  'dovnitr': 'inbound',
  'in': 'inbound',
  // English passthrough
  'outbound': 'outbound',
  'inbound': 'inbound',
};

export const VISIT_TYPE_ALIASES: Record<string, string> = {
  'revize': 'revision',
  'kontrola': 'revision',
  'instalace': 'installation',
  'montáž': 'installation',
  'montaz': 'installation',
  'oprava': 'repair',
  'servis': 'repair',
  'konzultace': 'consultation',
  'poradenství': 'consultation',
  'poradenstvi': 'consultation',
  'následná': 'follow_up',
  'nasledna': 'follow_up',
  'follow-up': 'follow_up',
  // English passthrough
  'revision': 'revision',
  'installation': 'installation',
  'repair': 'repair',
  'consultation': 'consultation',
  'follow_up': 'follow_up',
};

export const VISIT_STATUS_ALIASES: Record<string, string> = {
  'naplánováno': 'planned',
  'naplanovano': 'planned',
  'plánováno': 'planned',
  'planovano': 'planned',
  'probíhá': 'in_progress',
  'probiha': 'in_progress',
  'dokončeno': 'completed',
  'dokonceno': 'completed',
  'hotovo': 'completed',
  'zrušeno': 'cancelled',
  'zruseno': 'cancelled',
  'přeplánováno': 'rescheduled',
  'preplanovano': 'rescheduled',
  // English passthrough
  'planned': 'planned',
  'in_progress': 'in_progress',
  'completed': 'completed',
  'cancelled': 'cancelled',
  'rescheduled': 'rescheduled',
};

export const WORK_TYPE_ALIASES: Record<string, string> = {
  'revize': 'revision',
  'kontrola': 'revision',
  'oprava': 'repair',
  'servis': 'repair',
  'instalace': 'installation',
  'montáž': 'installation',
  'montaz': 'installation',
  'konzultace': 'consultation',
  'poradenství': 'consultation',
  'poradenstvi': 'consultation',
  'následná': 'follow_up',
  'nasledna': 'follow_up',
  'follow-up': 'follow_up',
  // English passthrough
  'revision': 'revision',
  'repair': 'repair',
  'installation': 'installation',
  'consultation': 'consultation',
  'follow_up': 'follow_up',
};

export const WORK_RESULT_ALIASES: Record<string, string> = {
  'úspěšná': 'successful',
  'uspesna': 'successful',
  'ok': 'successful',
  'částečná': 'partial',
  'castecna': 'partial',
  'neúspěšná': 'failed',
  'neuspesna': 'failed',
  'nok': 'failed',
  'nepřítomen': 'customer_absent',
  'nepritomen': 'customer_absent',
  'přeplánováno': 'rescheduled',
  'preplanovano': 'rescheduled',
  // English passthrough
  'successful': 'successful',
  'partial': 'partial',
  'failed': 'failed',
  'customer_absent': 'customer_absent',
  'rescheduled': 'rescheduled',
};

export const VISIT_RESULT_ALIASES: Record<string, string> = {
  'úspěšná': 'successful',
  'uspesna': 'successful',
  'ok': 'successful',
  'částečná': 'partial',
  'castecna': 'partial',
  'částečně': 'partial',
  'castecne': 'partial',
  'neúspěšná': 'failed',
  'neuspesna': 'failed',
  'nok': 'failed',
  'nepřítomen': 'customer_absent',
  'nepritomen': 'customer_absent',
  'nikdo doma': 'customer_absent',
  'přeplánováno': 'rescheduled',
  'preplanovano': 'rescheduled',
  'odloženo': 'rescheduled',
  'odlozeno': 'rescheduled',
  // English passthrough
  'successful': 'successful',
  'partial': 'partial',
  'failed': 'failed',
  'customer_absent': 'customer_absent',
  'rescheduled': 'rescheduled',
};
