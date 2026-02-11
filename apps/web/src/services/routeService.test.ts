import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitRoutePlanJob, type CustomerTimeWindow, type RoutePlanJobRequest } from './routeService';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

// Mock natsStore
const mockRequest = vi.fn();

vi.mock('../stores/natsStore', () => ({
  useNatsStore: {
    getState: () => ({
      request: mockRequest,
    }),
  },
}));

describe('routeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitRoutePlanJob', () => {
    const baseRequest: RoutePlanJobRequest = {
      customerIds: ['cust-1', 'cust-2'],
      date: '2026-02-10',
      startLocation: { lat: 49.19, lng: 16.60 },
    };

    it('submits job without timeWindows when none are provided', async () => {
      mockRequest.mockResolvedValue({
        payload: { jobId: 'job-1', position: 1, estimatedWaitSeconds: 3 },
      });

      await submitRoutePlanJob(baseRequest, { request: mockRequest });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [subject, payload] = mockRequest.mock.calls[0];
      expect(subject).toBe('sazinka.route.submit');
      // timeWindows should NOT be present
      expect(payload.payload.timeWindows).toBeUndefined();
    });

    it('includes timeWindows in payload when provided', async () => {
      const timeWindows: CustomerTimeWindow[] = [
        { customerId: 'cust-1', start: '08:00', end: '09:00' },
        { customerId: 'cust-2', start: '10:00', end: '11:00' },
      ];

      mockRequest.mockResolvedValue({
        payload: { jobId: 'job-2', position: 1, estimatedWaitSeconds: 3 },
      });

      await submitRoutePlanJob(
        { ...baseRequest, timeWindows },
        { request: mockRequest },
      );

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.payload.timeWindows).toBeDefined();
      expect(payload.payload.timeWindows).toHaveLength(2);
      expect(payload.payload.timeWindows[0]).toEqual({
        customerId: 'cust-1',
        start: '08:00',
        end: '09:00',
      });
      expect(payload.payload.timeWindows[1]).toEqual({
        customerId: 'cust-2',
        start: '10:00',
        end: '11:00',
      });
    });

    it('does not include timeWindows when array is empty', async () => {
      mockRequest.mockResolvedValue({
        payload: { jobId: 'job-3', position: 1, estimatedWaitSeconds: 3 },
      });

      await submitRoutePlanJob(
        { ...baseRequest, timeWindows: [] },
        { request: mockRequest },
      );

      const [, payload] = mockRequest.mock.calls[0];
      // Empty array should be excluded (falsy spread)
      expect(payload.payload.timeWindows).toBeUndefined();
    });

    it('includes crewId when provided', async () => {
      mockRequest.mockResolvedValue({
        payload: { jobId: 'job-4', position: 1, estimatedWaitSeconds: 3 },
      });

      await submitRoutePlanJob(
        { ...baseRequest, crewId: 'crew-abc' },
        { request: mockRequest },
      );

      const [, payload] = mockRequest.mock.calls[0];
      expect(payload.payload.crewId).toBe('crew-abc');
    });

    it('throws on error response', async () => {
      mockRequest.mockResolvedValue({
        error: { code: 'SUBMIT_ERROR', message: 'Queue full' },
      });

      await expect(
        submitRoutePlanJob(baseRequest, { request: mockRequest }),
      ).rejects.toThrow('Queue full');
    });
  });

  describe('CustomerTimeWindow type', () => {
    it('has expected shape', () => {
      const tw: CustomerTimeWindow = {
        customerId: 'abc-123',
        start: '14:00',
        end: '15:00',
      };

      expect(tw.customerId).toBe('abc-123');
      expect(tw.start).toBe('14:00');
      expect(tw.end).toBe('15:00');
    });
  });
});
