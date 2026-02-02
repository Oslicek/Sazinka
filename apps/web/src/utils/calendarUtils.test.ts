import { describe, it, expect } from 'vitest';
import {
  getMonthDays,
  getMonthRange,
  groupRevisionsByDay,
  getRevisionCountClass,
  type CalendarDay,
} from './calendarUtils';
import type { Revision } from '@shared/revision';

describe('calendarUtils', () => {
  describe('getMonthRange', () => {
    it('should return first and last day of month', () => {
      const { start, end } = getMonthRange(2026, 0); // January 2026
      expect(start).toBe('2026-01-01');
      expect(end).toBe('2026-01-31');
    });

    it('should handle February in leap year', () => {
      const { start, end } = getMonthRange(2024, 1); // February 2024 (leap year)
      expect(start).toBe('2024-02-01');
      expect(end).toBe('2024-02-29');
    });

    it('should handle February in non-leap year', () => {
      const { start, end } = getMonthRange(2025, 1); // February 2025
      expect(start).toBe('2025-02-01');
      expect(end).toBe('2025-02-28');
    });

    it('should handle December', () => {
      const { start, end } = getMonthRange(2026, 11); // December 2026
      expect(start).toBe('2026-12-01');
      expect(end).toBe('2026-12-31');
    });
  });

  describe('getMonthDays', () => {
    it('should return array of calendar days', () => {
      const days = getMonthDays(2026, 0); // January 2026
      expect(days.length).toBeGreaterThanOrEqual(28);
      expect(days.length).toBeLessThanOrEqual(42); // max 6 weeks
    });

    it('should include padding days from previous month', () => {
      // January 2026 starts on Thursday (index 4 in Mon-Sun week)
      const days = getMonthDays(2026, 0);
      
      // First day should be Monday of the week containing Jan 1
      // Jan 1, 2026 is Thursday, so padding starts from Monday Dec 29, 2025
      const firstDay = days[0];
      expect(firstDay.isCurrentMonth).toBe(false);
      expect(firstDay.date.getMonth()).toBe(11); // December
    });

    it('should include padding days from next month', () => {
      const days = getMonthDays(2026, 0);
      const lastDay = days[days.length - 1];
      
      // Last day should either be in January or February
      // If it's not in January, it should be marked as not current month
      if (lastDay.date.getMonth() !== 0) {
        expect(lastDay.isCurrentMonth).toBe(false);
      }
    });

    it('should mark today correctly', () => {
      const today = new Date();
      const days = getMonthDays(today.getFullYear(), today.getMonth());
      
      const todayEntry = days.find(d => d.isToday);
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.date.getDate()).toBe(today.getDate());
    });

    it('should have correct dateKey format YYYY-MM-DD', () => {
      const days = getMonthDays(2026, 0);
      const firstJanDay = days.find(d => d.isCurrentMonth && d.date.getDate() === 1);
      
      expect(firstJanDay).toBeDefined();
      expect(firstJanDay!.dateKey).toBe('2026-01-01');
    });

    it('should return exactly 42 days (6 rows) for consistent grid', () => {
      const days = getMonthDays(2026, 0);
      expect(days.length).toBe(42);
    });
  });

  describe('groupRevisionsByDay', () => {
    const mockRevisionsScheduled: Partial<Revision>[] = [
      { id: '1', scheduledDate: '2026-01-15', status: 'scheduled' },
      { id: '2', scheduledDate: '2026-01-15', status: 'confirmed' },
      { id: '3', scheduledDate: '2026-01-20', status: 'scheduled' },
    ];

    const mockRevisionsDue: Partial<Revision>[] = [
      { id: '1', dueDate: '2026-01-15', status: 'upcoming' },
      { id: '2', dueDate: '2026-01-15', status: 'upcoming' },
      { id: '3', dueDate: '2026-01-25', status: 'upcoming' },
    ];

    it('should group revisions by scheduled date when dateField is scheduled', () => {
      const grouped = groupRevisionsByDay(mockRevisionsScheduled as Revision[], 'scheduled');
      
      expect(grouped['2026-01-15']).toHaveLength(2);
      expect(grouped['2026-01-20']).toHaveLength(1);
    });

    it('should group revisions by due date when dateField is due (default)', () => {
      const grouped = groupRevisionsByDay(mockRevisionsDue as Revision[]);
      
      expect(grouped['2026-01-15']).toHaveLength(2);
      expect(grouped['2026-01-25']).toHaveLength(1);
    });

    it('should return empty object for empty array', () => {
      const grouped = groupRevisionsByDay([]);
      expect(grouped).toEqual({});
    });

    it('should skip revisions without the specified date field', () => {
      const revisionsWithoutDate: Partial<Revision>[] = [
        { id: '1', status: 'upcoming' },
        { id: '2', scheduledDate: '2026-01-10', status: 'scheduled' }, // has scheduled but no due
      ];
      
      // Default is 'due', so revision without dueDate should be skipped
      const grouped = groupRevisionsByDay(revisionsWithoutDate as Revision[]);
      expect(Object.keys(grouped)).toHaveLength(0);
      
      // With 'scheduled', revision with scheduledDate should be included
      const groupedScheduled = groupRevisionsByDay(revisionsWithoutDate as Revision[], 'scheduled');
      expect(Object.keys(groupedScheduled)).toHaveLength(1);
      expect(groupedScheduled['2026-01-10']).toHaveLength(1);
    });
  });

  describe('getRevisionCountClass', () => {
    it('should return empty string for 0 revisions', () => {
      expect(getRevisionCountClass(0)).toBe('');
    });

    it('should return "low" for 1-2 revisions', () => {
      expect(getRevisionCountClass(1)).toBe('low');
      expect(getRevisionCountClass(2)).toBe('low');
    });

    it('should return "medium" for 3-5 revisions', () => {
      expect(getRevisionCountClass(3)).toBe('medium');
      expect(getRevisionCountClass(4)).toBe('medium');
      expect(getRevisionCountClass(5)).toBe('medium');
    });

    it('should return "high" for 6+ revisions', () => {
      expect(getRevisionCountClass(6)).toBe('high');
      expect(getRevisionCountClass(10)).toBe('high');
    });
  });
});
