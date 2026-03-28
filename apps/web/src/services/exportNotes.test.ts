/**
 * Phase U8: Export notes.csv + legacy CSV changes tests
 * NE1–NE15 (TypeScript service layer)
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExportPlusFile } from './exportPlusService';
import { submitExportJob, type ExportPlusRequest } from './exportPlusService';

vi.mock('../stores/natsStore', () => ({
  useNatsStore: {
    getState: vi.fn(() => ({ request: vi.fn() })),
  },
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

vi.mock('@shared/messages', () => ({
  createRequest: (_token: string, payload: unknown) => ({ token: 'test-token', payload }),
}));

// ── NE1: notes is a valid ExportPlusFile value ───────────────────────────────

describe('Export notes.csv contract', () => {
  it('NE1: notes is a valid ExportPlusFile value', () => {
    const f: ExportPlusFile = 'notes';
    expect(f).toBe('notes');
  });

  it('NE2: notes can be included in selectedFiles request', async () => {
    const { useNatsStore } = await import('../stores/natsStore');
    const mockRequest = vi.fn(async () => ({
      id: 'test-id',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job-001', position: 1, estimatedWaitSeconds: 3, message: 'queued' },
    }));
    (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: mockRequest });

    const req: ExportPlusRequest = {
      scope: 'customer_only',
      selectedFiles: ['notes'],
      filters: {},
    };

    await submitExportJob(req);
    expect(mockRequest).toHaveBeenCalledWith(
      'sazinka.export.submit',
      expect.objectContaining({ payload: expect.objectContaining({ selectedFiles: ['notes'] }) })
    );
  });

  it('NE3: notes can be combined with other files in selectedFiles', () => {
    const files: ExportPlusFile[] = ['customers', 'devices', 'notes'];
    expect(files).toContain('notes');
    expect(files).toContain('customers');
  });

  it('NE4: all legacy files + notes are valid ExportPlusFile values', () => {
    const allFiles: ExportPlusFile[] = [
      'customers',
      'devices',
      'revisions',
      'communications',
      'work_log',
      'routes',
      'notes',
    ];
    expect(allFiles).toHaveLength(7);
    expect(allFiles).toContain('notes');
  });

  it('NE5: customers is still a valid ExportPlusFile (not removed)', () => {
    const f: ExportPlusFile = 'customers';
    expect(f).toBe('customers');
  });

  it('NE6: devices is still a valid ExportPlusFile (not removed)', () => {
    const f: ExportPlusFile = 'devices';
    expect(f).toBe('devices');
  });

  it('NE7: submitExportJob sends notes in selectedFiles to correct NATS subject', async () => {
    const { useNatsStore } = await import('../stores/natsStore');
    const mockRequest = vi.fn(async () => ({
      id: 'test-id',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job-002', position: 1, estimatedWaitSeconds: 3, message: 'queued' },
    }));
    (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: mockRequest });

    const req: ExportPlusRequest = {
      scope: 'all_workers_combined',
      selectedFiles: ['customers', 'notes'],
      filters: {},
    };

    await submitExportJob(req);
    expect(mockRequest).toHaveBeenCalledWith(
      'sazinka.export.submit',
      expect.objectContaining({ payload: expect.objectContaining({ selectedFiles: ['customers', 'notes'] }) })
    );
  });

  it('NE8: single_worker scope with notes in selectedFiles', async () => {
    const { useNatsStore } = await import('../stores/natsStore');
    const mockRequest = vi.fn(async () => ({
      id: 'test-id',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job-003', position: 1, estimatedWaitSeconds: 3, message: 'queued' },
    }));
    (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: mockRequest });

    const req: ExportPlusRequest = {
      scope: 'single_worker',
      selectedFiles: ['notes'],
      selectedWorkerId: 'worker-001',
      filters: {},
    };

    await submitExportJob(req);
    expect(mockRequest).toHaveBeenCalledWith(
      'sazinka.export.submit',
      expect.objectContaining({
        payload: expect.objectContaining({
          scope: 'single_worker',
          selectedFiles: ['notes'],
        }),
      })
    );
  });
});
