import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitGeocodeJob,
  submitRouteJob,
  submitImportJob,
  getJobQueueStats,
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

  describe('submitGeocodeJob', () => {
    it('submits geocode job with correct subject', async () => {
      mockRequest.mockResolvedValue({ jobId: 'geo-1', status: 'queued' });

      const result = await submitGeocodeJob({
        customerId: 'c-123',
        address: 'Václavské náměstí 1, Praha',
      });

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.geocode.submit',
        {
          customerId: 'c-123',
          address: 'Václavské náměstí 1, Praha',
        },
        expect.any(Number)
      );
      expect(result).toEqual({ jobId: 'geo-1', status: 'queued' });
    });
  });

  describe('submitRouteJob', () => {
    it('submits route job with correct subject', async () => {
      mockRequest.mockResolvedValue({ jobId: 'route-1', status: 'queued', position: 2 });

      const result = await submitRouteJob({
        customerIds: ['c1', 'c2', 'c3'],
        date: '2026-02-03',
      });

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.route.submit',
        {
          customerIds: ['c1', 'c2', 'c3'],
          date: '2026-02-03',
        },
        expect.any(Number)
      );
      expect(result).toEqual({ jobId: 'route-1', status: 'queued', position: 2 });
    });
  });

  describe('submitImportJob', () => {
    it('submits import job with correct subject', async () => {
      mockRequest.mockResolvedValue({ jobId: 'import-1', status: 'queued' });

      const result = await submitImportJob({
        type: 'customers',
        data: [{ name: 'Test' }],
      });

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.import.submit',
        {
          type: 'customers',
          data: [{ name: 'Test' }],
        },
        expect.any(Number)
      );
      expect(result).toEqual({ jobId: 'import-1', status: 'queued' });
    });
  });

  describe('getJobQueueStats', () => {
    it('requests queue stats with correct subject', async () => {
      mockRequest.mockResolvedValue({
        pendingJobs: 5,
        processingJobs: 2,
        completedLast24h: 150,
        failedLast24h: 3,
      });

      const result = await getJobQueueStats();

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.admin.jetstream.status',
        {},
        expect.any(Number)
      );
      expect(result).toEqual({
        pendingJobs: 5,
        processingJobs: 2,
        completedLast24h: 150,
        failedLast24h: 3,
      });
    });
  });
});
