import { useState, useCallback, useRef, useEffect } from 'react';
import { useNatsStore } from '../stores/natsStore';
import {
  type JobStatus,
  type JobStatusUpdate,
  type JobSubmitResponse,
  type JobType,
  getJobStatusSubject,
  getJobSubmitSubject,
  isTerminal,
  isActive as checkIsActive,
} from '../types/jobStatus';

/** Options for useJobStatus hook */
export interface UseJobStatusOptions<TResult = unknown> {
  /** Type of job (geocode, route, import) */
  jobType: JobType;
  /** Callback when job completes successfully */
  onCompleted?: (result?: TResult) => void;
  /** Callback when job fails */
  onFailed?: (error: string) => void;
  /** Timeout for job submission request (ms) */
  submitTimeoutMs?: number;
}

/** Return value from useJobStatus hook */
export interface UseJobStatusReturn<TPayload = unknown, TResult = unknown> {
  /** Current job status (null if no active job) */
  status: JobStatus<TResult> | null;
  /** Current job ID (null if no active job) */
  jobId: string | null;
  /** Whether there's an active job (queued or processing) */
  isActive: boolean;
  /** Submit a new job */
  submit: (payload: TPayload) => Promise<string>;
  /** Cancel the current job subscription */
  cancel: () => void;
  /** Reset state to allow submitting a new job */
  reset: () => void;
}

/**
 * Hook for managing job status subscriptions
 * 
 * Handles the complete lifecycle of a job:
 * 1. Submit job to backend
 * 2. Subscribe to status updates
 * 3. Update state on status changes
 * 4. Call callbacks on completion/failure
 * 5. Clean up subscription on unmount or terminal state
 * 
 * @example
 * ```tsx
 * const { status, submit, isActive } = useJobStatus({
 *   jobType: 'route',
 *   onCompleted: (result) => setRoute(result),
 *   onFailed: (error) => showError(error),
 * });
 * 
 * const handlePlan = async () => {
 *   await submit({ customerIds: ['c1', 'c2'] });
 * };
 * ```
 */
export function useJobStatus<TPayload = unknown, TResult = unknown>(
  options: UseJobStatusOptions<TResult>
): UseJobStatusReturn<TPayload, TResult> {
  const { jobType, onCompleted, onFailed, submitTimeoutMs = 10000 } = options;
  
  const [status, setStatus] = useState<JobStatus<TResult> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  
  // Store unsubscribe function
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  // Store callbacks in refs to avoid stale closures
  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);
  
  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onFailedRef.current = onFailed;
  }, [onCompleted, onFailed]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);
  
  const handleStatusUpdate = useCallback((update: JobStatusUpdate<TResult>) => {
    setStatus(update.status);
    
    // Handle terminal states
    if (isTerminal(update.status)) {
      // Unsubscribe
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      
      // Call appropriate callback
      if (update.status.type === 'completed') {
        onCompletedRef.current?.(update.status.result);
      } else if (update.status.type === 'failed') {
        onFailedRef.current?.(update.status.error);
      }
    }
  }, []);
  
  const submit = useCallback(async (payload: TPayload): Promise<string> => {
    // Prevent submitting if already has active job
    if (jobId !== null && status !== null && checkIsActive(status)) {
      throw new Error('Job already in progress');
    }
    
    const { request, subscribe } = useNatsStore.getState();
    
    // Submit job
    const response = await request<TPayload, JobSubmitResponse>(
      getJobSubmitSubject(jobType),
      payload,
      submitTimeoutMs
    );
    
    // Set initial state
    setJobId(response.jobId);
    setStatus({
      type: 'queued',
      position: response.position,
    });
    
    // Subscribe to status updates
    const unsubscribe = await subscribe<JobStatusUpdate<TResult>>(
      getJobStatusSubject(jobType, response.jobId),
      handleStatusUpdate
    );
    unsubscribeRef.current = unsubscribe;
    
    return response.jobId;
  }, [jobId, status, jobType, submitTimeoutMs, handleStatusUpdate]);
  
  const cancel = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setStatus(null);
    setJobId(null);
  }, []);
  
  const reset = useCallback(() => {
    setStatus(null);
    setJobId(null);
  }, []);
  
  const isActive = status !== null && checkIsActive(status);
  
  return {
    status,
    jobId,
    isActive,
    submit,
    cancel,
    reset,
  };
}
