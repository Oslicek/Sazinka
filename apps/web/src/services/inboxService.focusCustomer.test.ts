/**
 * Phase 3 (RED → GREEN) — inboxService focusCustomerId transport contract tests.
 *
 * S3-1: Sends focusCustomerId when provided
 * S3-2: Omits focusCustomerId when undefined
 * S3-3: Handles response with focusedCustomerIncluded=true
 * S3-4: Handles response with focusedCustomerIncluded=false
 * S3-5: Backward compatibility — flag absent in response, no throw
 * S3-6: Error response path unchanged
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getInbox, type InboxServiceDeps } from './inboxService';
import type { InboxResponse } from '@shared/inbox';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-user-id',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

const baseResponse: InboxResponse = {
  items: [],
  total: 0,
  overdueCount: 0,
  dueSoonCount: 0,
};

describe('inboxService – focusCustomerId transport contract', () => {
  const mockRequest = vi.fn();
  const mockDeps: InboxServiceDeps = { request: mockRequest };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('S3-1: includes focusCustomerId in outgoing payload when provided', async () => {
    mockRequest.mockResolvedValueOnce({ payload: baseResponse });

    await getInbox({ focusCustomerId: 'cust-42' }, mockDeps);

    expect(mockRequest).toHaveBeenCalledWith(
      'sazinka.inbox.query',
      expect.objectContaining({ payload: expect.objectContaining({ focusCustomerId: 'cust-42' }) })
    );
  });

  it('S3-2: omits focusCustomerId from outgoing payload when undefined', async () => {
    mockRequest.mockResolvedValueOnce({ payload: baseResponse });

    await getInbox({ limit: 100 }, mockDeps);

    const [, sentRequest] = mockRequest.mock.calls[0];
    expect(sentRequest.payload).not.toHaveProperty('focusCustomerId');
  });

  it('S3-3: parsed response preserves focusedCustomerIncluded=true', async () => {
    mockRequest.mockResolvedValueOnce({
      payload: { ...baseResponse, focusedCustomerIncluded: true },
    });

    const result = await getInbox({}, mockDeps);

    expect(result.focusedCustomerIncluded).toBe(true);
  });

  it('S3-4: parsed response preserves focusedCustomerIncluded=false', async () => {
    mockRequest.mockResolvedValueOnce({
      payload: { ...baseResponse, focusedCustomerIncluded: false },
    });

    const result = await getInbox({}, mockDeps);

    expect(result.focusedCustomerIncluded).toBe(false);
  });

  it('S3-5: backward compatibility — flag absent in response does not throw', async () => {
    mockRequest.mockResolvedValueOnce({ payload: baseResponse });

    const result = await getInbox({}, mockDeps);

    expect(result).toBeDefined();
    expect(result.focusedCustomerIncluded).toBeUndefined();
  });

  it('S3-6: error response path unchanged — throws expected error', async () => {
    mockRequest.mockResolvedValueOnce({
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });

    await expect(getInbox({ focusCustomerId: 'cust-99' }, mockDeps)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
