import { describe, it, expect } from 'vitest';
import {
  getJobStatusSubject,
  getJobSubmitSubject,
  isQueued,
  isProcessing,
  isCompleted,
  isFailed,
  isTerminal,
  isActive,
  type JobStatus,
  type JobStatusQueued,
  type JobStatusProcessing,
  type JobStatusCompleted,
  type JobStatusFailed,
} from './jobStatus';

describe('jobStatus types', () => {
  describe('getJobStatusSubject', () => {
    it('returns correct subject for geocode job', () => {
      expect(getJobStatusSubject('geocode', 'abc-123')).toBe(
        'sazinka.job.geocode.status.abc-123'
      );
    });

    it('returns correct subject for route job', () => {
      expect(getJobStatusSubject('route', 'xyz-456')).toBe(
        'sazinka.job.route.status.xyz-456'
      );
    });

    it('returns correct subject for import job', () => {
      expect(getJobStatusSubject('import', 'job-789')).toBe(
        'sazinka.job.import.status.job-789'
      );
    });
  });

  describe('getJobSubmitSubject', () => {
    it('returns correct subject for geocode submission', () => {
      expect(getJobSubmitSubject('geocode')).toBe('sazinka.geocode.submit');
    });

    it('returns correct subject for route submission', () => {
      expect(getJobSubmitSubject('route')).toBe('sazinka.route.submit');
    });

    it('returns correct subject for import submission', () => {
      expect(getJobSubmitSubject('import')).toBe('sazinka.import.submit');
    });
  });

  describe('type guards', () => {
    const queuedStatus: JobStatusQueued = { type: 'queued', position: 3 };
    const processingStatus: JobStatusProcessing = {
      type: 'processing',
      progress: 50,
      message: 'Loading...',
    };
    const completedStatus: JobStatusCompleted<string> = {
      type: 'completed',
      result: 'success',
    };
    const failedStatus: JobStatusFailed = {
      type: 'failed',
      error: 'Something went wrong',
      retryable: true,
    };

    describe('isQueued', () => {
      it('returns true for queued status', () => {
        expect(isQueued(queuedStatus)).toBe(true);
      });

      it('returns false for other statuses', () => {
        expect(isQueued(processingStatus)).toBe(false);
        expect(isQueued(completedStatus)).toBe(false);
        expect(isQueued(failedStatus)).toBe(false);
      });
    });

    describe('isProcessing', () => {
      it('returns true for processing status', () => {
        expect(isProcessing(processingStatus)).toBe(true);
      });

      it('returns false for other statuses', () => {
        expect(isProcessing(queuedStatus)).toBe(false);
        expect(isProcessing(completedStatus)).toBe(false);
        expect(isProcessing(failedStatus)).toBe(false);
      });
    });

    describe('isCompleted', () => {
      it('returns true for completed status', () => {
        expect(isCompleted(completedStatus)).toBe(true);
      });

      it('returns false for other statuses', () => {
        expect(isCompleted(queuedStatus)).toBe(false);
        expect(isCompleted(processingStatus)).toBe(false);
        expect(isCompleted(failedStatus)).toBe(false);
      });
    });

    describe('isFailed', () => {
      it('returns true for failed status', () => {
        expect(isFailed(failedStatus)).toBe(true);
      });

      it('returns false for other statuses', () => {
        expect(isFailed(queuedStatus)).toBe(false);
        expect(isFailed(processingStatus)).toBe(false);
        expect(isFailed(completedStatus)).toBe(false);
      });
    });

    describe('isTerminal', () => {
      it('returns true for completed status', () => {
        expect(isTerminal(completedStatus)).toBe(true);
      });

      it('returns true for failed status', () => {
        expect(isTerminal(failedStatus)).toBe(true);
      });

      it('returns false for queued and processing', () => {
        expect(isTerminal(queuedStatus)).toBe(false);
        expect(isTerminal(processingStatus)).toBe(false);
      });
    });

    describe('isActive', () => {
      it('returns true for queued status', () => {
        expect(isActive(queuedStatus)).toBe(true);
      });

      it('returns true for processing status', () => {
        expect(isActive(processingStatus)).toBe(true);
      });

      it('returns false for terminal states', () => {
        expect(isActive(completedStatus)).toBe(false);
        expect(isActive(failedStatus)).toBe(false);
      });
    });
  });

  describe('JobStatus union type', () => {
    it('accepts queued status', () => {
      const status: JobStatus = { type: 'queued' };
      expect(status.type).toBe('queued');
    });

    it('accepts processing status with all fields', () => {
      const status: JobStatus = {
        type: 'processing',
        progress: 75,
        processed: 15,
        total: 20,
        message: 'Processing batch 4 of 5',
      };
      expect(status.type).toBe('processing');
      if (isProcessing(status)) {
        expect(status.progress).toBe(75);
        expect(status.processed).toBe(15);
        expect(status.total).toBe(20);
      }
    });

    it('accepts completed status with typed result', () => {
      interface RouteResult {
        routeId: string;
        distance: number;
      }
      const status: JobStatus<RouteResult> = {
        type: 'completed',
        result: { routeId: 'route-1', distance: 45.5 },
      };
      expect(status.type).toBe('completed');
      if (isCompleted(status)) {
        expect(status.result?.routeId).toBe('route-1');
      }
    });

    it('accepts failed status', () => {
      const status: JobStatus = {
        type: 'failed',
        error: 'Network timeout',
        retryable: true,
      };
      expect(status.type).toBe('failed');
      if (isFailed(status)) {
        expect(status.error).toBe('Network timeout');
        expect(status.retryable).toBe(true);
      }
    });
  });
});
