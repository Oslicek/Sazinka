/**
 * Generic Job Status Types
 * 
 * Unified types for all async job operations (geocoding, route optimization, import).
 * Maps to NATS JetStream message lifecycle states.
 * 
 * JetStream States → UI States:
 * - PENDING → queued
 * - DELIVERED + WPI → processing
 * - ACKED → completed
 * - NACKED (max retries) / TERM → failed
 */

/** Job status type enum */
export type JobStatusType = 'queued' | 'processing' | 'completed' | 'failed';

/** Job waiting in queue */
export interface JobStatusQueued {
  type: 'queued';
  /** Position in queue (1-based) */
  position?: number;
}

/** Job currently being processed */
export interface JobStatusProcessing {
  type: 'processing';
  /** Progress percentage (0-100) */
  progress?: number;
  /** Number of items processed */
  processed?: number;
  /** Total items to process */
  total?: number;
  /** Current stage or message */
  message?: string;
}

/** Job completed successfully */
export interface JobStatusCompleted<T = unknown> {
  type: 'completed';
  /** Result data (job-type specific) */
  result?: T;
}

/** Job failed */
export interface JobStatusFailed {
  type: 'failed';
  /** Error message */
  error: string;
  /** Whether the job can be retried */
  retryable?: boolean;
}

/** Union type for all job statuses */
export type JobStatus<T = unknown> = 
  | JobStatusQueued 
  | JobStatusProcessing 
  | JobStatusCompleted<T> 
  | JobStatusFailed;

/** Job status update message from backend */
export interface JobStatusUpdate<T = unknown> {
  /** Unique job identifier */
  jobId: string;
  /** ISO timestamp of the update */
  timestamp: string;
  /** Current status */
  status: JobStatus<T>;
}

/** Job submission response from backend */
export interface JobSubmitResponse {
  /** Unique job identifier */
  jobId: string;
  /** Initial status (usually 'queued') */
  status: JobStatusType;
  /** Position in queue if queued */
  position?: number;
}

/** Supported job types */
export type JobType = 
  | 'geocode' 
  | 'route' 
  | 'import' 
  | 'export' 
  | 'valhalla.matrix' 
  | 'valhalla.geometry'
  | 'email'
  | 'sms';

/** Get the NATS subject for job status updates */
export function getJobStatusSubject(jobType: JobType, jobId: string): string {
  return `sazinka.job.${jobType}.status.${jobId}`;
}

/** Get the NATS subject for job submission */
export function getJobSubmitSubject(jobType: JobType): string {
  return `sazinka.${jobType}.submit`;
}

/** Get human-readable job type name */
export function getJobTypeName(jobType: JobType): string {
  const names: Record<JobType, string> = {
    'geocode': 'Geokódování',
    'route': 'Plánování trasy',
    'import': 'Import dat',
    'export': 'Export dat',
    'valhalla.matrix': 'Výpočet matice vzdáleností',
    'valhalla.geometry': 'Výpočet geometrie trasy',
    'email': 'Odesílání emailu',
    'sms': 'Odesílání SMS',
  };
  return names[jobType] || jobType;
}

/** Get icon for job type */
export function getJobTypeIcon(jobType: JobType): string {
  const icons: Record<JobType, string> = {
    'geocode': '📍',
    'route': '🗺️',
    'import': '📥',
    'export': '📤',
    'valhalla.matrix': '📊',
    'valhalla.geometry': '📐',
    'email': '📧',
    'sms': '📱',
  };
  return icons[jobType] || '⚙️';
}

/** Type guard for JobStatusQueued */
export function isQueued(status: JobStatus | null): status is JobStatusQueued {
  return status !== null && status.type === 'queued';
}

/** Type guard for JobStatusProcessing */
export function isProcessing(status: JobStatus | null): status is JobStatusProcessing {
  return status !== null && status.type === 'processing';
}

/** Type guard for JobStatusCompleted */
export function isCompleted<T>(status: JobStatus<T> | null): status is JobStatusCompleted<T> {
  return status !== null && status.type === 'completed';
}

/** Type guard for JobStatusFailed */
export function isFailed(status: JobStatus | null): status is JobStatusFailed {
  return status !== null && status.type === 'failed';
}

/** Check if job is in a terminal state (completed or failed) */
export function isTerminal(status: JobStatus | null): boolean {
  return status !== null && (status.type === 'completed' || status.type === 'failed');
}

/** Check if job is active (queued or processing) */
export function isActive(status: JobStatus | null): boolean {
  return status !== null && (status.type === 'queued' || status.type === 'processing');
}
