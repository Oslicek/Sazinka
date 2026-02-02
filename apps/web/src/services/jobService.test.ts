import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listJobHistory,
  cancelJob,
  retryJob,
} from './jobService';

// Mock natsStore
const mockRequest = vi.fn();

vi.mock('../stores/natsStore', () => ({
  useNatsStore: {
    getState: () => ({
      request: mockRequest,
    }),
  },
}));

describe('jobService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listJobHistory', () => {
    it('requests job history with default options', async () => {
      mockRequest.mockResolvedValue({
        jobs: [
          { id: 'j1', jobType: 'geocode', status: 'completed', durationMs: 1000 },
        ],
        total: 1,
      });

      const result = await listJobHistory();

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.jobs.history',
        {}
      );
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].jobType).toBe('geocode');
    });

    it('requests job history with limit', async () => {
      mockRequest.mockResolvedValue({ jobs: [], total: 0 });

      await listJobHistory({ limit: 10 });

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.jobs.history',
        { limit: 10 }
      );
    });

    it('requests job history filtered by type', async () => {
      mockRequest.mockResolvedValue({ jobs: [], total: 0 });

      await listJobHistory({ jobType: 'geocode' });

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.jobs.history',
        { jobType: 'geocode' }
      );
    });
  });

  describe('cancelJob', () => {
    it('sends cancel request with correct subject', async () => {
      mockRequest.mockResolvedValue({
        success: true,
        message: 'Job cancelled',
        jobId: 'job-123',
      });

      const result = await cancelJob('job-123', 'geocode');

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.jobs.cancel',
        { jobId: 'job-123', jobType: 'geocode' }
      );
      expect(result.success).toBe(true);
    });
  });

  describe('retryJob', () => {
    it('sends retry request with correct subject', async () => {
      mockRequest.mockResolvedValue({
        success: true,
        message: 'Job retried',
        jobId: 'job-456',
      });

      const result = await retryJob('job-456', 'geocode');

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.jobs.retry',
        { jobId: 'job-456', jobType: 'geocode' }
      );
      expect(result.success).toBe(true);
    });
  });
});
