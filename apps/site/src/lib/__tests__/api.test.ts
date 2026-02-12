// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { submitContact, submitNewsletter } from '../api';

describe('api client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('submitContact posts payload and returns parsed response', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, ticketId: 'REQ-2026-000001' }),
    });

    const result = await submitContact({
      email: 'john@doe.com',
      message: 'Hello',
      locale: 'en',
      website: '',
    });

    expect(result.success).toBe(true);
    expect(result.ticketId).toBe('REQ-2026-000001');
  });

  test('submitNewsletter posts payload and returns parsed response', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, pendingConfirmation: true }),
    });

    const result = await submitNewsletter({
      email: 'john@doe.com',
      locale: 'en',
      gdprConsent: true,
      website: '',
    });

    expect(result.success).toBe(true);
    expect(result.pendingConfirmation).toBe(true);
  });
});
