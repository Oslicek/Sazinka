import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRevision,
  listRevisions,
  getRevision,
  updateRevision,
  completeRevision,
  deleteRevision,
  getUpcomingRevisions,
  getRevisionStats,
  getSuggestedRevisions,
  type RevisionServiceDeps,
} from './revisionService';
import type { Revision } from '@shared/revision';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-user-id',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

describe('revisionService', () => {
  const mockRequest = vi.fn();
  const mockDeps: RevisionServiceDeps = {
    request: mockRequest,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRevision: Revision = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    deviceId: 'device-123',
    customerId: 'customer-123',
    userId: 'user-123',
    status: 'upcoming',
    dueDate: '2026-03-01',
    scheduledDate: '2026-02-28',
    scheduledTimeStart: '09:00',
    scheduledTimeEnd: '10:00',
    createdAt: '2026-01-26T12:00:00Z',
    updatedAt: '2026-01-26T12:00:00Z',
  };

  describe('createRevision', () => {
    const createRequest = {
      deviceId: 'device-123',
      customerId: 'customer-123',
      dueDate: '2026-03-01',
      scheduledDate: '2026-02-28',
      scheduledTimeStart: '09:00',
      scheduledTimeEnd: '10:00',
    };

    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockRevision });

      await createRevision(createRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.create',
        expect.objectContaining({
          payload: createRequest,
        })
      );
    });

    it('should return created revision on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockRevision });

      const result = await createRevision(createRequest, mockDeps);

      expect(result).toEqual(mockRevision);
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Connection failed' },
      });

      await expect(createRevision(createRequest, mockDeps)).rejects.toThrow(
        'Connection failed'
      );
    });
  });

  describe('listRevisions', () => {
    const mockRevisions: Revision[] = [mockRevision];

    it('should call NATS with correct subject and filters', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockRevisions, total: 1 },
      });

      await listRevisions({ customerId: 'customer-123', status: 'upcoming' }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.list',
        expect.objectContaining({
          payload: { customerId: 'customer-123', status: 'upcoming' },
        })
      );
    });

    it('should return list of revisions', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockRevisions, total: 1 },
      });

      const result = await listRevisions({}, mockDeps);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should pass date range filters', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: [], total: 0 },
      });

      await listRevisions(
        { fromDate: '2026-01-01', toDate: '2026-12-31' },
        mockDeps
      );

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.list',
        expect.objectContaining({
          payload: { fromDate: '2026-01-01', toDate: '2026-12-31' },
        })
      );
    });
  });

  describe('getRevision', () => {
    it('should call NATS with correct subject and revision id', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockRevision });

      await getRevision('revision-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.get',
        expect.objectContaining({
          payload: { id: 'revision-123' },
        })
      );
    });

    it('should return revision on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockRevision });

      const result = await getRevision('revision-123', mockDeps);

      expect(result).toEqual(mockRevision);
    });

    it('should throw error when revision not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Revision not found' },
      });

      await expect(getRevision('revision-123', mockDeps)).rejects.toThrow(
        'Revision not found'
      );
    });
  });

  describe('updateRevision', () => {
    const updateRequest = {
      id: 'revision-123',
      status: 'scheduled',
      scheduledDate: '2026-03-15',
    };

    it('should call NATS with correct subject and update data', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { ...mockRevision, ...updateRequest } });

      await updateRevision(updateRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.update',
        expect.objectContaining({
          payload: updateRequest,
        })
      );
    });

    it('should return updated revision on success', async () => {
      const updatedRevision = { ...mockRevision, status: 'scheduled', scheduledDate: '2026-03-15' };
      mockRequest.mockResolvedValueOnce({ payload: updatedRevision });

      const result = await updateRevision(updateRequest, mockDeps);

      expect(result.status).toBe('scheduled');
      expect(result.scheduledDate).toBe('2026-03-15');
    });
  });

  describe('completeRevision', () => {
    const completeRequest = {
      id: 'revision-123',
      result: 'passed',
      findings: 'Vše v pořádku',
      durationMinutes: 45,
    };

    it('should call NATS with correct subject and completion data', async () => {
      const completedRevision = {
        ...mockRevision,
        status: 'completed',
        result: 'passed',
        findings: 'Vše v pořádku',
        durationMinutes: 45,
        completedAt: '2026-01-26T14:00:00Z',
      };
      mockRequest.mockResolvedValueOnce({ payload: completedRevision });

      await completeRevision(completeRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.complete',
        expect.objectContaining({
          payload: completeRequest,
        })
      );
    });

    it('should return completed revision on success', async () => {
      const completedRevision = {
        ...mockRevision,
        status: 'completed',
        result: 'passed',
        completedAt: '2026-01-26T14:00:00Z',
      };
      mockRequest.mockResolvedValueOnce({ payload: completedRevision });

      const result = await completeRevision(completeRequest, mockDeps);

      expect(result.status).toBe('completed');
      expect(result.result).toBe('passed');
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('deleteRevision', () => {
    it('should call NATS with correct subject and revision id', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      await deleteRevision('revision-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.delete',
        expect.objectContaining({
          payload: { id: 'revision-123' },
        })
      );
    });

    it('should return true on successful deletion', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      const result = await deleteRevision('revision-123', mockDeps);

      expect(result).toBe(true);
    });
  });

  describe('getUpcomingRevisions', () => {
    it('should call NATS with correct subject and days ahead', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { overdue: [], dueSoon: [] },
      });

      await getUpcomingRevisions(14, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.upcoming',
        expect.objectContaining({
          payload: { daysAhead: 14 },
        })
      );
    });

    it('should return overdue and due soon revisions', async () => {
      const overdueRevision = { ...mockRevision, status: 'overdue', dueDate: '2026-01-01' };
      const dueSoonRevision = { ...mockRevision, status: 'due_soon', dueDate: '2026-02-05' };

      mockRequest.mockResolvedValueOnce({
        payload: { overdue: [overdueRevision], dueSoon: [dueSoonRevision] },
      });

      const result = await getUpcomingRevisions(30, mockDeps);

      expect(result.overdue).toHaveLength(1);
      expect(result.dueSoon).toHaveLength(1);
    });
  });

  describe('getRevisionStats', () => {
    const mockStats = {
      overdue: 5,
      dueThisWeek: 12,
      scheduledToday: 3,
      completedThisMonth: 28,
    };

    it('should call NATS with correct subject', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockStats });

      await getRevisionStats(mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.stats',
        expect.objectContaining({
          payload: {},
        })
      );
    });

    it('should return revision statistics', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockStats });

      const result = await getRevisionStats(mockDeps);

      expect(result.overdue).toBe(5);
      expect(result.dueThisWeek).toBe(12);
      expect(result.scheduledToday).toBe(3);
      expect(result.completedThisMonth).toBe(28);
    });

    it('should throw error when stats cannot be retrieved', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Query failed' },
      });

      await expect(getRevisionStats(mockDeps)).rejects.toThrow('Query failed');
    });
  });

  describe('getSuggestedRevisions', () => {
    const mockSuggestion = {
      id: 'revision-123',
      deviceId: 'device-456',
      customerId: 'customer-789',
      userId: 'user-123',
      status: 'upcoming',
      dueDate: '2026-02-10',
      scheduledDate: null,
      scheduledTimeStart: null,
      scheduledTimeEnd: null,
      customerName: 'Test Customer',
      customerStreet: 'Test Street 1',
      customerCity: 'Prague',
      customerLat: 50.08,
      customerLng: 14.42,
      priorityScore: 80,
      daysUntilDue: 5,
      priorityReason: 'due_this_week',
    };

    it('should call NATS with correct subject and date', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { suggestions: [mockSuggestion], totalCandidates: 1 },
      });

      await getSuggestedRevisions('2026-02-05', 50, [], mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.suggest',
        expect.objectContaining({
          payload: {
            date: '2026-02-05',
            maxCount: 50,
            excludeIds: undefined,
          },
        })
      );
    });

    it('should pass excludeIds when provided', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { suggestions: [], totalCandidates: 0 },
      });

      await getSuggestedRevisions('2026-02-05', 10, ['rev-1', 'rev-2'], mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.revision.suggest',
        expect.objectContaining({
          payload: {
            date: '2026-02-05',
            maxCount: 10,
            excludeIds: ['rev-1', 'rev-2'],
          },
        })
      );
    });

    it('should return suggestions with priority scores', async () => {
      const overdueSuggestion = { ...mockSuggestion, priorityScore: 100, priorityReason: 'overdue' };
      const upcomingSuggestion = { ...mockSuggestion, id: 'rev-2', priorityScore: 40, priorityReason: 'due_this_month' };

      mockRequest.mockResolvedValueOnce({
        payload: { suggestions: [overdueSuggestion, upcomingSuggestion], totalCandidates: 25 },
      });

      const result = await getSuggestedRevisions('2026-02-05', 50, [], mockDeps);

      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].priorityScore).toBe(100);
      expect(result.suggestions[0].priorityReason).toBe('overdue');
      expect(result.totalCandidates).toBe(25);
    });

    it('should throw error when suggestions cannot be retrieved', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Query failed' },
      });

      await expect(getSuggestedRevisions('2026-02-05', 50, [], mockDeps)).rejects.toThrow('Query failed');
    });
  });
});
