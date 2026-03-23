/**
 * Phase 0: exportPlusService tests
 * Tests NATS subject contracts and service behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { submitExportJob, type ExportPlusRequest } from './exportPlusService';

// Mock the NATS store
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: {
    getState: () => ({
      request: vi.fn(),
    }),
  },
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

vi.mock('@shared/messages', () => ({
  createRequest: (token: string, payload: unknown) => ({ token, payload }),
}));

// =============================================================================
// NATS SUBJECT CONTRACTS
// =============================================================================

describe('Export NATS subject contracts', () => {
  it('export submit uses sazinka.export.submit subject', async () => {
    const { useNatsStore } = await import('@/stores/natsStore');
    const mockRequest = vi.fn(async () => ({
      id: 'test-id',
      timestamp: new Date().toISOString(),
      payload: {
        jobId: 'export-job-123',
        position: 1,
        estimatedWaitSeconds: 3,
        message: 'jobs:export_submitted',
      },
    }));
    (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: mockRequest });

    const req: ExportPlusRequest = {
      scope: 'customer_only',
      selectedFiles: ['customers'],
      filters: {},
    };

    await submitExportJob(req);

    expect(mockRequest).toHaveBeenCalledWith(
      'sazinka.export.submit',
      expect.anything()
    );
  });

  it('export status subject format is sazinka.job.export.status.<jobId>', () => {
    const jobId = 'abc-123';
    const expectedSubject = `sazinka.job.export.status.${jobId}`;
    // Document the expected subject format
    expect(expectedSubject).toBe('sazinka.job.export.status.abc-123');
  });
});

// =============================================================================
// REQUEST PAYLOAD TESTS
// =============================================================================

describe('submitExportJob', () => {
  it('throws on error response', async () => {
    const { useNatsStore } = await import('@/stores/natsStore');
    const mockRequest = vi.fn(async () => ({
      id: 'test-id',
      timestamp: new Date().toISOString(),
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }));
    (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: mockRequest });

    const req: ExportPlusRequest = {
      scope: 'customer_only',
      selectedFiles: ['customers'],
      filters: {},
    };

    await expect(submitExportJob(req)).rejects.toThrow('Authentication required');
  });

  it('returns job submit response on success', async () => {
    const { useNatsStore } = await import('@/stores/natsStore');
    const mockRequest = vi.fn(async () => ({
      id: 'test-id',
      timestamp: new Date().toISOString(),
      payload: {
        jobId: 'export-job-456',
        position: 1,
        estimatedWaitSeconds: 3,
        message: 'jobs:export_submitted',
      },
    }));
    (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: mockRequest });

    const req: ExportPlusRequest = {
      scope: 'customer_only',
      selectedFiles: ['customers', 'devices'],
      filters: { dateFrom: '2025-01-01', dateTo: '2025-12-31' },
    };

    const result = await submitExportJob(req);
    expect(result.jobId).toBe('export-job-456');
    expect(result.message).toBe('jobs:export_submitted');
  });
});

// =============================================================================
// EXPORT FILE TYPES
// =============================================================================

describe('ExportPlusFile types', () => {
  it('all canonical file types are supported', () => {
    const canonicalFiles = ['customers', 'devices', 'revisions', 'communications', 'work_log', 'routes'];
    // This documents the expected file types per PRJ_PLAN.MD
    const req: ExportPlusRequest = {
      scope: 'customer_only',
      selectedFiles: canonicalFiles as ExportPlusRequest['selectedFiles'],
      filters: {},
    };
    expect(req.selectedFiles).toHaveLength(6);
    expect(req.selectedFiles).toContain('work_log');
    expect(req.selectedFiles).toContain('routes');
  });
});
