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

import i18n from '@/i18n';

/** Job status type enum */
export type JobStatusType = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

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

/** Job cancelled by user */
export interface JobStatusCancelled {
  type: 'cancelled';
  /** Optional message */
  message?: string;
}

/** Union type for all job statuses */
export type JobStatus<T = unknown> = 
  | JobStatusQueued 
  | JobStatusProcessing 
  | JobStatusCompleted<T> 
  | JobStatusFailed
  | JobStatusCancelled;

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

/** i18n keys for job type names (jobs namespace) */
const JOB_TYPE_NAME_KEYS: Record<JobType, string> = {
  'geocode': 'jobs:job_type_geocode',
  'route': 'jobs:job_type_route',
  'import': 'jobs:job_type_import',
  'export': 'jobs:job_type_export',
  'valhalla.matrix': 'jobs:job_type_valhalla_matrix',
  'valhalla.geometry': 'jobs:job_type_valhalla_geometry',
  'email': 'jobs:job_type_email',
  'sms': 'jobs:job_type_sms',
};

/** Get human-readable job type name */
export function getJobTypeName(jobType: JobType): string {
  return i18n.t(JOB_TYPE_NAME_KEYS[jobType]) || jobType;
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

/** Type guard for JobStatusCancelled */
export function isCancelled(status: JobStatus | null): status is JobStatusCancelled {
  return status !== null && status.type === 'cancelled';
}

/** Check if job is in a terminal state (completed, failed, or cancelled) */
export function isTerminal(status: JobStatus | null): boolean {
  return status !== null && (status.type === 'completed' || status.type === 'failed' || status.type === 'cancelled');
}

/** Check if job is active (queued or processing) */
export function isActive(status: JobStatus | null): boolean {
  return status !== null && (status.type === 'queued' || status.type === 'processing');
}
