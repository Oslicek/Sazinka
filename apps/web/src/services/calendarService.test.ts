import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listCalendarItems } from './calendarService';
import type { Revision } from '@shared/revision';
import type { Visit } from '@shared/visit';
import type { Communication } from '@shared/communication';

// Mock service dependencies
vi.mock('./revisionService', () => ({
  listRevisions: vi.fn(),
}));

vi.mock('./visitService', () => ({
  listVisits: vi.fn(),
  getVisitTypeLabel: vi.fn((type: string) => type),
}));

vi.mock('./communicationService', () => ({
  listCommunications: vi.fn(),
  getCommunicationTypeLabel: vi.fn((type: string) => type),
}));

import { listRevisions } from './revisionService';
import { listVisits } from './visitService';
import { listCommunications } from './communicationService';

describe('calendarService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listCalendarItems', () => {
    it('should fetch and normalize all item types', async () => {
      const mockRevisions: Partial<Revision>[] = [
        {
          id: 'rev-1',
          customerId: 'cust-1',
          customerName: 'Customer A',
          deviceId: 'dev-1',
          deviceType: 'chimney',
          dueDate: '2026-01-15',
          scheduledDate: '2026-01-15',
          status: 'scheduled',
        },
      ];

      const mockVisits: Partial<Visit>[] = [
        {
          id: 'visit-1',
          customerId: 'cust-2',
          customerName: 'Customer B',
          scheduledDate: '2026-01-16',
          visitType: 'revision',
          status: 'planned',
        },
      ];

      const mockCommunications: Partial<Communication>[] = [
        {
          id: 'comm-1',
          customerId: 'cust-3',
          contactName: 'Customer C',
          followUpDate: '2026-01-17',
          commType: 'call',
          followUpCompleted: false,
        },
      ];

      vi.mocked(listRevisions).mockResolvedValue({ items: mockRevisions as Revision[], total: 1 });
      vi.mocked(listVisits).mockResolvedValue({ visits: mockVisits as Visit[], total: 1 });
      vi.mocked(listCommunications).mockResolvedValue({
        communications: mockCommunications as Communication[],
        total: 1,
      });

      const result = await listCalendarItems('user-1', {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result.items).toHaveLength(3);
      expect(result.items[0].type).toBe('revision');
      expect(result.items[1].type).toBe('visit');
      expect(result.items[2].type).toBe('task');
    });

    it('should filter by item types', async () => {
      vi.mocked(listRevisions).mockResolvedValue({ items: [], total: 0 });
      vi.mocked(listVisits).mockResolvedValue({ visits: [], total: 0 });
      vi.mocked(listCommunications).mockResolvedValue({ communications: [], total: 0 });

      await listCalendarItems('user-1', {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        types: ['revision'],
      });

      expect(listRevisions).toHaveBeenCalled();
      expect(listVisits).not.toHaveBeenCalled();
      expect(listCommunications).not.toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      const mockRevisions: Partial<Revision>[] = [
        { id: '1', dueDate: '2026-01-15', status: 'scheduled', customerName: 'A' },
        { id: '2', dueDate: '2026-01-16', status: 'completed', customerName: 'B' },
      ];

      vi.mocked(listRevisions).mockResolvedValue({ items: mockRevisions as Revision[], total: 2 });
      vi.mocked(listVisits).mockResolvedValue({ visits: [], total: 0 });
      vi.mocked(listCommunications).mockResolvedValue({ communications: [], total: 0 });

      const result = await listCalendarItems('user-1', {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        status: ['scheduled'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('scheduled');
    });

    it('should filter by crew', async () => {
      const mockRevisions: Partial<Revision>[] = [
        { id: '1', dueDate: '2026-01-15', status: 'scheduled', assignedCrewId: 'crew-1', customerName: 'A' },
        { id: '2', dueDate: '2026-01-16', status: 'scheduled', assignedCrewId: 'crew-2', customerName: 'B' },
      ];

      vi.mocked(listRevisions).mockResolvedValue({ items: mockRevisions as Revision[], total: 2 });
      vi.mocked(listVisits).mockResolvedValue({ visits: [], total: 0 });
      vi.mocked(listCommunications).mockResolvedValue({ communications: [], total: 0 });

      const result = await listCalendarItems('user-1', {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        crewId: 'crew-1',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].crewId).toBe('crew-1');
    });

    it('should filter by customer query', async () => {
      const mockRevisions: Partial<Revision>[] = [
        { id: '1', dueDate: '2026-01-15', status: 'scheduled', customerName: 'ABC Company' },
        { id: '2', dueDate: '2026-01-16', status: 'scheduled', customerName: 'XYZ Corp' },
      ];

      vi.mocked(listRevisions).mockResolvedValue({ items: mockRevisions as Revision[], total: 2 });
      vi.mocked(listVisits).mockResolvedValue({ visits: [], total: 0 });
      vi.mocked(listCommunications).mockResolvedValue({ communications: [], total: 0 });

      const result = await listCalendarItems('user-1', {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        customerQuery: 'ABC',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].customerName).toBe('ABC Company');
    });

    it('should sort items by date and time', async () => {
      const mockRevisions: Partial<Revision>[] = [
        {
          id: '1',
          dueDate: '2026-01-16',
          scheduledTimeStart: '14:00',
          status: 'scheduled',
          customerName: 'B',
        },
        {
          id: '2',
          dueDate: '2026-01-15',
          scheduledTimeStart: '09:00',
          status: 'scheduled',
          customerName: 'A',
        },
        {
          id: '3',
          dueDate: '2026-01-15',
          scheduledTimeStart: '11:00',
          status: 'scheduled',
          customerName: 'C',
        },
      ];

      vi.mocked(listRevisions).mockResolvedValue({ items: mockRevisions as Revision[], total: 3 });
      vi.mocked(listVisits).mockResolvedValue({ visits: [], total: 0 });
      vi.mocked(listCommunications).mockResolvedValue({ communications: [], total: 0 });

      const result = await listCalendarItems('user-1', {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result.items).toHaveLength(3);
      expect(result.items[0].customerName).toBe('A'); // 2026-01-15 09:00
      expect(result.items[1].customerName).toBe('C'); // 2026-01-15 11:00
      expect(result.items[2].customerName).toBe('B'); // 2026-01-16 14:00
    });
  });
});
