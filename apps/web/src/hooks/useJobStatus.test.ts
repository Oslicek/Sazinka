import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useJobStatus } from './useJobStatus';
import type { JobStatus, JobStatusUpdate } from '../types/jobStatus';

// Mock natsStore
const mockRequest = vi.fn();
const mockSubscribe = vi.fn();
let mockUnsubscribe = vi.fn();

vi.mock('../stores/natsStore', () => ({
  useNatsStore: {
    getState: () => ({
      request: mockRequest,
      subscribe: mockSubscribe,
      isConnected: true,
    }),
  },
}));

describe('useJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnsubscribe = vi.fn();
    mockSubscribe.mockResolvedValue(mockUnsubscribe);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('returns null status initially', () => {
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      expect(result.current.status).toBeNull();
      expect(result.current.jobId).toBeNull();
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('submit', () => {
    it('submits job and returns job ID', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-123', status: 'queued' });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      let jobId: string | undefined;
      await act(async () => {
        jobId = await result.current.submit({ customers: ['c1', 'c2'] });
      });
      
      expect(jobId).toBe('job-123');
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.route.submit',
        { customers: ['c1', 'c2'] },
        expect.any(Number)
      );
    });

    it('sets initial queued status after submit', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-456', status: 'queued', position: 2 });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'geocode' }));
      
      await act(async () => {
        await result.current.submit({ address: '123 Main St' });
      });
      
      expect(result.current.jobId).toBe('job-456');
      expect(result.current.status).toEqual({ type: 'queued', position: 2 });
      expect(result.current.isActive).toBe(true);
    });

    it('subscribes to status updates after submit', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-789', status: 'queued' });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'import' }));
      
      await act(async () => {
        await result.current.submit({ file: 'data.csv' });
      });
      
      expect(mockSubscribe).toHaveBeenCalledWith(
        'sazinka.job.import.status.job-789',
        expect.any(Function)
      );
    });

    it('throws error if already has active job', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      await act(async () => {
        await result.current.submit({ data: 1 });
      });
      
      await expect(async () => {
        await act(async () => {
          await result.current.submit({ data: 2 });
        });
      }).rejects.toThrow('Job already in progress');
    });
  });

  describe('status updates', () => {
    it('updates status when receiving processing update', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      let statusCallback: ((msg: JobStatusUpdate) => void) | null = null;
      mockSubscribe.mockImplementation((_subject: string, callback: (msg: JobStatusUpdate) => void) => {
        statusCallback = callback;
        return Promise.resolve(mockUnsubscribe);
      });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      await act(async () => {
        await result.current.submit({});
      });
      
      expect(statusCallback).not.toBeNull();
      
      // Simulate processing status update
      await act(async () => {
        statusCallback!({
          jobId: 'job-1',
          timestamp: new Date().toISOString(),
          status: { type: 'processing', progress: 50, message: 'Building matrix' },
        });
      });
      
      expect(result.current.status).toEqual({
        type: 'processing',
        progress: 50,
        message: 'Building matrix',
      });
      expect(result.current.isActive).toBe(true);
    });

    it('calls onCompleted callback when job completes', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      let statusCallback: ((msg: JobStatusUpdate) => void) | null = null;
      mockSubscribe.mockImplementation((_subject: string, callback: (msg: JobStatusUpdate) => void) => {
        statusCallback = callback;
        return Promise.resolve(mockUnsubscribe);
      });
      
      const onCompleted = vi.fn();
      const { result } = renderHook(() => 
        useJobStatus({ jobType: 'route', onCompleted })
      );
      
      await act(async () => {
        await result.current.submit({});
      });
      
      // Simulate completed status
      await act(async () => {
        statusCallback!({
          jobId: 'job-1',
          timestamp: new Date().toISOString(),
          status: { type: 'completed', result: { routeId: 'route-1' } },
        });
      });
      
      expect(result.current.status?.type).toBe('completed');
      expect(result.current.isActive).toBe(false);
      expect(onCompleted).toHaveBeenCalled();
    });

    it('calls onFailed callback when job fails', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      let statusCallback: ((msg: JobStatusUpdate) => void) | null = null;
      mockSubscribe.mockImplementation((_subject: string, callback: (msg: JobStatusUpdate) => void) => {
        statusCallback = callback;
        return Promise.resolve(mockUnsubscribe);
      });
      
      const onFailed = vi.fn();
      const { result } = renderHook(() => 
        useJobStatus({ jobType: 'geocode', onFailed })
      );
      
      await act(async () => {
        await result.current.submit({});
      });
      
      // Simulate failed status
      await act(async () => {
        statusCallback!({
          jobId: 'job-1',
          timestamp: new Date().toISOString(),
          status: { type: 'failed', error: 'Network timeout' },
        });
      });
      
      expect(result.current.status?.type).toBe('failed');
      expect(result.current.isActive).toBe(false);
      expect(onFailed).toHaveBeenCalledWith('Network timeout');
    });

    it('unsubscribes when job reaches terminal state', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      let statusCallback: ((msg: JobStatusUpdate) => void) | null = null;
      mockSubscribe.mockImplementation((_subject: string, callback: (msg: JobStatusUpdate) => void) => {
        statusCallback = callback;
        return Promise.resolve(mockUnsubscribe);
      });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      await act(async () => {
        await result.current.submit({});
      });
      
      // Status update should not unsubscribe
      await act(async () => {
        statusCallback!({
          jobId: 'job-1',
          timestamp: new Date().toISOString(),
          status: { type: 'processing', progress: 50 },
        });
      });
      expect(mockUnsubscribe).not.toHaveBeenCalled();
      
      // Completed should unsubscribe
      await act(async () => {
        statusCallback!({
          jobId: 'job-1',
          timestamp: new Date().toISOString(),
          status: { type: 'completed' },
        });
      });
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('unsubscribes and resets state', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      await act(async () => {
        await result.current.submit({});
      });
      
      expect(result.current.isActive).toBe(true);
      
      act(() => {
        result.current.cancel();
      });
      
      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(result.current.status).toBeNull();
      expect(result.current.jobId).toBeNull();
      expect(result.current.isActive).toBe(false);
    });

    it('does nothing if no active job', () => {
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      // Should not throw
      act(() => {
        result.current.cancel();
      });
      
      expect(result.current.status).toBeNull();
    });
  });

  describe('cleanup on unmount', () => {
    it('unsubscribes on unmount', async () => {
      mockRequest.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
      
      const { result, unmount } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      await act(async () => {
        await result.current.submit({});
      });
      
      unmount();
      
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('allows submitting new job after reset', async () => {
      mockRequest
        .mockResolvedValueOnce({ jobId: 'job-1', status: 'queued' })
        .mockResolvedValueOnce({ jobId: 'job-2', status: 'queued' });
      
      let statusCallback: ((msg: JobStatusUpdate) => void) | null = null;
      mockSubscribe.mockImplementation((_subject: string, callback: (msg: JobStatusUpdate) => void) => {
        statusCallback = callback;
        return Promise.resolve(mockUnsubscribe);
      });
      
      const { result } = renderHook(() => useJobStatus({ jobType: 'route' }));
      
      // First job
      await act(async () => {
        await result.current.submit({ data: 1 });
      });
      
      // Complete first job
      await act(async () => {
        statusCallback!({
          jobId: 'job-1',
          timestamp: new Date().toISOString(),
          status: { type: 'completed' },
        });
      });
      
      // Reset
      act(() => {
        result.current.reset();
      });
      
      expect(result.current.status).toBeNull();
      expect(result.current.jobId).toBeNull();
      
      // Should be able to submit again
      await act(async () => {
        await result.current.submit({ data: 2 });
      });
      
      expect(result.current.jobId).toBe('job-2');
    });
  });
});
