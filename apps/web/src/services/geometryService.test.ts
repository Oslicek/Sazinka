import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitGeometryJob,
  subscribeToGeometryJobStatus,
  type GeometryJobStatusUpdate,
} from './geometryService';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-user-id',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

describe('geometryService', () => {
  const mockRequest = vi.fn();
  const mockSubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitGeometryJob', () => {
    it('sends locations to valhalla.geometry.submit', async () => {
      const locations = [
        { lat: 50.0, lng: 14.0 },
        { lat: 49.0, lng: 16.0 },
      ];

      mockRequest.mockResolvedValueOnce({
        payload: { jobId: 'job-123', message: 'Queued' },
      });

      const result = await submitGeometryJob(locations, { request: mockRequest });

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.valhalla.geometry.submit',
        expect.objectContaining({
          payload: { locations },
        }),
      );
      expect(result.jobId).toBe('job-123');
    });

    it('throws on error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { message: 'Service unavailable' },
      });

      await expect(
        submitGeometryJob(
          [{ lat: 50, lng: 14 }],
          { request: mockRequest },
        ),
      ).rejects.toThrow('Service unavailable');
    });
  });

  describe('subscribeToGeometryJobStatus', () => {
    it('subscribes to job status subject', async () => {
      const unsubFn = vi.fn();
      mockSubscribe.mockResolvedValueOnce(unsubFn);

      const callback = vi.fn();
      const unsub = await subscribeToGeometryJobStatus(
        'job-123',
        callback,
        { subscribe: mockSubscribe },
      );

      expect(mockSubscribe).toHaveBeenCalledWith(
        'sazinka.job.valhalla.geometry.status.job-123',
        callback,
      );
      expect(unsub).toBe(unsubFn);
    });

    it('throws if subscribe is not available', async () => {
      await expect(
        subscribeToGeometryJobStatus('job-123', vi.fn(), { subscribe: undefined as any }),
      ).rejects.toThrow();
    });
  });
});
