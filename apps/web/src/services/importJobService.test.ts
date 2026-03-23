/**
 * Phase 0: importJobService tests
 * Tests NATS subject contracts and service behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  submitCustomerImportJob,
  submitDeviceImportJob,
  submitRevisionImportJob,
  submitCommunicationImportJob,
  submitWorkLogImportJob,
  submitZipImportJob,
  type ImportJobServiceDeps,
} from './importJobService';

// Mock auth to avoid "Not authenticated" errors
vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

// =============================================================================
// NATS SUBJECT CONTRACTS
// These tests document the required subjects after Phase 1 fixes.
// =============================================================================

describe('NATS subject contracts', () => {
  const EXPECTED_SUBJECTS = {
    customer: {
      submit: 'sazinka.import.customer.submit',
      status: 'sazinka.job.import.customer.status',
    },
    device: {
      submit: 'sazinka.import.device.submit',
      status: 'sazinka.job.import.device.status',
    },
    revision: {
      submit: 'sazinka.import.revision.submit',
      status: 'sazinka.job.import.revision.status',
    },
    communication: {
      submit: 'sazinka.import.communication.submit',
      status: 'sazinka.job.import.communication.status',
    },
    worklog: {
      submit: 'sazinka.import.worklog.submit',
      status: 'sazinka.job.import.worklog.status',
    },
    zip: {
      submit: 'sazinka.import.zip.submit',
      status: 'sazinka.job.import.zip.status',
    },
  };

  function makeDeps(capturedSubject: { value: string }): ImportJobServiceDeps {
    return {
      request: vi.fn(async (subject: string) => {
        capturedSubject.value = subject;
        return {
          id: 'test-id',
          timestamp: new Date().toISOString(),
          payload: { jobId: 'job-123', message: 'import:job_queued' },
        };
      }),
    };
  }

  it('customer import submits to correct subject', async () => {
    const captured = { value: '' };
    await submitCustomerImportJob('csv', 'test.csv', makeDeps(captured));
    expect(captured.value).toBe(EXPECTED_SUBJECTS.customer.submit);
  });

  it('device import submits to correct subject', async () => {
    const captured = { value: '' };
    await submitDeviceImportJob('csv', 'devices.csv', makeDeps(captured));
    expect(captured.value).toBe(EXPECTED_SUBJECTS.device.submit);
  });

  it('revision import submits to correct subject', async () => {
    const captured = { value: '' };
    await submitRevisionImportJob('csv', 'revisions.csv', makeDeps(captured));
    expect(captured.value).toBe(EXPECTED_SUBJECTS.revision.submit);
  });

  it('communication import submits to correct subject', async () => {
    const captured = { value: '' };
    await submitCommunicationImportJob('csv', 'comms.csv', makeDeps(captured));
    expect(captured.value).toBe(EXPECTED_SUBJECTS.communication.submit);
  });

  it('work log import submits to correct subject', async () => {
    const captured = { value: '' };
    await submitWorkLogImportJob('csv', 'work_log.csv', makeDeps(captured));
    // Currently uses 'sazinka.import.visit.submit' - should be 'sazinka.import.worklog.submit'
    // This test will FAIL until Phase 1/7 aligns the subject
    expect(captured.value).toBe(EXPECTED_SUBJECTS.worklog.submit);
  });

  it('zip import submits to correct subject', async () => {
    const captured = { value: '' };
    await submitZipImportJob('base64content', 'import.zip', makeDeps(captured));
    expect(captured.value).toBe(EXPECTED_SUBJECTS.zip.submit);
  });
});

// =============================================================================
// SERVICE BEHAVIOR TESTS
// =============================================================================

describe('submitCustomerImportJob', () => {
  it('returns job response on success', async () => {
    const deps: ImportJobServiceDeps = {
      request: vi.fn(async () => ({
        id: 'test-id',
        timestamp: new Date().toISOString(),
        payload: { jobId: 'job-abc', message: 'import:job_queued' },
      })),
    };

    const result = await submitCustomerImportJob('name;city\nJan;Praha', 'test.csv', deps);
    expect(result.jobId).toBe('job-abc');
    expect(result.message).toBe('import:job_queued');
  });

  it('throws on error response', async () => {
    const deps: ImportJobServiceDeps = {
      request: vi.fn(async () => ({
        id: 'test-id',
        timestamp: new Date().toISOString(),
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      })),
    };

    await expect(submitCustomerImportJob('csv', 'test.csv', deps)).rejects.toThrow(
      'Authentication required'
    );
  });

  it('sends csv content and filename in payload', async () => {
    let capturedPayload: unknown;
    const deps: ImportJobServiceDeps = {
      request: vi.fn(async (_subject, payload) => {
        capturedPayload = payload;
        return {
          id: 'test-id',
          timestamp: new Date().toISOString(),
          payload: { jobId: 'job-123', message: 'import:job_queued' },
        };
      }),
    };

    await submitCustomerImportJob('name;city\nJan;Praha', 'customers.csv', deps);

    expect(capturedPayload).toBeDefined();
    const p = capturedPayload as { payload: { csvContent: string; filename: string } };
    expect(p.payload.csvContent).toBe('name;city\nJan;Praha');
    expect(p.payload.filename).toBe('customers.csv');
  });
});

describe('submitZipImportJob', () => {
  it('sends base64 content and filename', async () => {
    let capturedPayload: unknown;
    const deps: ImportJobServiceDeps = {
      request: vi.fn(async (_subject, payload) => {
        capturedPayload = payload;
        return {
          id: 'test-id',
          timestamp: new Date().toISOString(),
          payload: { jobId: 'job-zip', message: 'import:job_queued', detectedFiles: [] },
        };
      }),
    };

    await submitZipImportJob('base64data', 'archive.zip', deps);

    const p = capturedPayload as { payload: { zipContentBase64: string; filename: string } };
    expect(p.payload.zipContentBase64).toBe('base64data');
    expect(p.payload.filename).toBe('archive.zip');
  });
});
