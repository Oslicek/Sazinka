import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getInbox,
  createPlannedAction,
  updatePlannedAction,
  cancelPlannedAction,
  completePlannedAction,
  abandonCustomer,
  unabandonCustomer,
  type InboxServiceDeps,
} from './inboxService';
import type { InboxItem, InboxResponse } from '@shared/inbox';
import type { PlannedAction } from '@shared/plannedAction';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-user-id',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

describe('inboxService', () => {
  const mockRequest = vi.fn();
  const mockDeps: InboxServiceDeps = { request: mockRequest };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockInboxItem: InboxItem = {
    id: 'customer-1',
    name: 'Test Customer',
    phone: '+420123456789',
    city: 'Praha',
    postalCode: '12000',
    lat: 50.0755,
    lng: 14.4378,
    geocodeStatus: 'success',
    customerCreatedAt: '2026-01-01T00:00:00Z',
    lifecycleState: 'active',
    lifecycleRank: 2,
    nextActionKind: null,
    nextActionLabelKey: null,
    nextActionLabelFallback: null,
    nextActionDue: '2026-03-15',
    nextActionNote: null,
    totalCommunications: 3,
    lastContactAt: '2026-02-01T00:00:00Z',
    urgencyScore: 0,
  };

  const mockInboxResponse: InboxResponse = {
    items: [mockInboxItem],
    total: 1,
    overdueCount: 0,
    dueSoonCount: 1,
  };

  const mockPlannedAction: PlannedAction = {
    id: 'action-1',
    userId: 'user-1',
    customerId: 'customer-1',
    status: 'open',
    dueDate: '2026-03-15',
    snoozeUntil: null,
    snoozeReason: null,
    actionTargetId: null,
    revisionId: null,
    visitId: null,
    deviceId: null,
    note: 'Follow up',
    completedAt: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  // ============================================================================
  // getInbox
  // ============================================================================

  describe('getInbox', () => {
    it('calls sazinka.inbox.query with correct subject', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockInboxResponse });

      await getInbox({ limit: 25, offset: 0 }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.inbox.query',
        expect.objectContaining({ payload: { limit: 25, offset: 0 } })
      );
    });

    it('returns InboxResponse with items array', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockInboxResponse });

      const result = await getInbox({}, mockDeps);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].lifecycleState).toBe('active');
      expect(result.total).toBe(1);
    });

    it('items have lifecycleState field (not priority)', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockInboxResponse });

      const result = await getInbox({}, mockDeps);

      expect(result.items[0]).toHaveProperty('lifecycleState');
      expect(result.items[0]).not.toHaveProperty('priority');
    });

    it('throws on error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });

      await expect(getInbox({}, mockDeps)).rejects.toThrow('Authentication required');
    });
  });

  // ============================================================================
  // createPlannedAction
  // ============================================================================

  describe('createPlannedAction', () => {
    it('calls sazinka.planned_action.create with correct payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockPlannedAction });

      await createPlannedAction(
        { customerId: 'customer-1', dueDate: '2026-03-15', note: 'Follow up' },
        mockDeps
      );

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.planned_action.create',
        expect.objectContaining({
          payload: { customerId: 'customer-1', dueDate: '2026-03-15', note: 'Follow up' },
        })
      );
    });

    it('returns created PlannedAction', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockPlannedAction });

      const result = await createPlannedAction(
        { customerId: 'customer-1', dueDate: '2026-03-15' },
        mockDeps
      );

      expect(result.id).toBe('action-1');
      expect(result.status).toBe('open');
    });

    it('throws on error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'DB error' },
      });

      await expect(
        createPlannedAction({ customerId: 'customer-1', dueDate: '2026-03-15' }, mockDeps)
      ).rejects.toThrow('DB error');
    });
  });

  // ============================================================================
  // cancelPlannedAction
  // ============================================================================

  describe('cancelPlannedAction', () => {
    it('calls sazinka.planned_action.cancel with action ID', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { ...mockPlannedAction, status: 'cancelled' },
      });

      await cancelPlannedAction('action-1', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.planned_action.cancel',
        expect.objectContaining({ payload: 'action-1' })
      );
    });

    it('throws NOT_FOUND error for non-existent action', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Planned action not found' },
      });

      await expect(cancelPlannedAction('nonexistent', mockDeps)).rejects.toThrow(
        'Planned action not found'
      );
    });
  });

  // ============================================================================
  // abandonCustomer
  // ============================================================================

  describe('abandonCustomer', () => {
    it('calls sazinka.customer.abandon with customer ID', async () => {
      mockRequest.mockResolvedValueOnce({ payload: {} });

      await abandonCustomer('customer-1', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.customer.abandon',
        expect.objectContaining({ payload: 'customer-1' })
      );
    });
  });

  // ============================================================================
  // updatePlannedAction
  // ============================================================================

  describe('updatePlannedAction', () => {
    it('calls sazinka.planned_action.update', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockPlannedAction });

      await updatePlannedAction({ id: 'action-1', status: 'completed' }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.planned_action.update',
        expect.objectContaining({ payload: { id: 'action-1', status: 'completed' } })
      );
    });
  });

  // ============================================================================
  // completePlannedAction
  // ============================================================================

  describe('completePlannedAction', () => {
    it('calls sazinka.planned_action.complete', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { ...mockPlannedAction, status: 'completed' },
      });

      const result = await completePlannedAction('action-1', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.planned_action.complete',
        expect.objectContaining({ payload: 'action-1' })
      );
      expect(result.status).toBe('completed');
    });
  });

  // ============================================================================
  // unabandonCustomer
  // ============================================================================

  describe('unabandonCustomer', () => {
    it('calls sazinka.customer.unabandon', async () => {
      mockRequest.mockResolvedValueOnce({ payload: {} });

      await unabandonCustomer('customer-1', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.customer.unabandon',
        expect.objectContaining({ payload: 'customer-1' })
      );
    });
  });
});
