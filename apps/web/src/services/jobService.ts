/**
 * Job Service
 * 
 * Provides typed API for submitting jobs to the JetStream queue
 * and retrieving queue statistics.
 */

import { useNatsStore } from '../stores/natsStore';
import { type JobSubmitResponse, getJobSubmitSubject } from '../types/jobStatus';

const DEFAULT_TIMEOUT_MS = 10000;

// ============================================================================
// Geocode Jobs
// ============================================================================

export interface GeocodeJobPayload {
  /** Customer ID to geocode */
  customerId: string;
  /** Full address string */
  address: string;
}

/**
 * Submit a geocoding job to the queue
 */
export async function submitGeocodeJob(
  payload: GeocodeJobPayload,
  deps = { request: useNatsStore.getState().request }
): Promise<JobSubmitResponse> {
  const response = await deps.request<GeocodeJobPayload, JobSubmitResponse>(
    getJobSubmitSubject('geocode'),
    payload,
    DEFAULT_TIMEOUT_MS
  );
  return response;
}

// ============================================================================
// Route Jobs
// ============================================================================

export interface RouteJobPayload {
  /** Customer IDs to include in the route */
  customerIds: string[];
  /** Date for the route (YYYY-MM-DD) */
  date: string;
  /** Optional depot ID (uses default if not provided) */
  depotId?: string;
}

/**
 * Submit a route optimization job to the queue
 */
export async function submitRouteJob(
  payload: RouteJobPayload,
  deps = { request: useNatsStore.getState().request }
): Promise<JobSubmitResponse> {
  const response = await deps.request<RouteJobPayload, JobSubmitResponse>(
    getJobSubmitSubject('route'),
    payload,
    DEFAULT_TIMEOUT_MS
  );
  return response;
}

// ============================================================================
// Import Jobs
// ============================================================================

export interface ImportJobPayload {
  /** Type of data being imported */
  type: 'customers' | 'devices' | 'revisions';
  /** Data to import */
  data: unknown[];
}

/**
 * Submit an import job to the queue
 */
export async function submitImportJob(
  payload: ImportJobPayload,
  deps = { request: useNatsStore.getState().request }
): Promise<JobSubmitResponse> {
  const response = await deps.request<ImportJobPayload, JobSubmitResponse>(
    getJobSubmitSubject('import'),
    payload,
    DEFAULT_TIMEOUT_MS
  );
  return response;
}

// ============================================================================
// Queue Statistics
// ============================================================================

export interface JobQueueStats {
  /** Number of jobs waiting in queue */
  pendingJobs: number;
  /** Number of jobs currently being processed */
  processingJobs: number;
  /** Number of jobs completed in last 24 hours */
  completedLast24h: number;
  /** Number of jobs failed in last 24 hours */
  failedLast24h: number;
}

/**
 * Get queue statistics from JetStream
 */
export async function getJobQueueStats(
  deps = { request: useNatsStore.getState().request }
): Promise<JobQueueStats> {
  const response = await deps.request<Record<string, never>, JobQueueStats>(
    'sazinka.admin.jetstream.status',
    {},
    DEFAULT_TIMEOUT_MS
  );
  return response;
}
