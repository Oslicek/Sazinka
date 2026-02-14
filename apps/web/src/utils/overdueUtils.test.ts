import { describe, it, expect, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: { count?: number }) => {
      const count = opts?.count ?? 0;
      if (key === 'common:duration.zero_days') return '0 days';
      if (key === 'common:duration.years') return `${count} years`;
      if (key === 'common:duration.months') return `${count} months`;
      if (key === 'common:duration.days') return `${count} days`;
      return key;
    },
  },
}));

import { 
  formatOverdueDuration, 
  calculateOverdueInfo,
  type DeviceOverdueInfo 
} from './overdueUtils';

describe('formatOverdueDuration', () => {
  it('should format days only when less than a month', () => {
    expect(formatOverdueDuration(15)).toBe('15 days');
    expect(formatOverdueDuration(1)).toBe('1 days');
    expect(formatOverdueDuration(2)).toBe('2 days');
    expect(formatOverdueDuration(5)).toBe('5 days');
  });

  it('should format months and days when less than a year', () => {
    expect(formatOverdueDuration(45)).toBe('1 months, 15 days');
    expect(formatOverdueDuration(60)).toBe('2 months');
    expect(formatOverdueDuration(65)).toBe('2 months, 5 days');
    expect(formatOverdueDuration(120)).toBe('4 months');
    expect(formatOverdueDuration(150)).toBe('5 months');
  });

  it('should format years, months and days for longer periods', () => {
    expect(formatOverdueDuration(365)).toBe('1 years');
    expect(formatOverdueDuration(400)).toBe('1 years, 1 months, 5 days');
    expect(formatOverdueDuration(730)).toBe('2 years');
    expect(formatOverdueDuration(1081)).toBe('2 years, 11 months, 21 days');
    expect(formatOverdueDuration(1825)).toBe('5 years');
  });

  it('should handle zero days', () => {
    expect(formatOverdueDuration(0)).toBe('0 days');
  });

  it('should handle negative days (not overdue)', () => {
    expect(formatOverdueDuration(-5)).toBe(null);
  });
});

describe('calculateOverdueInfo', () => {
  const today = new Date('2026-02-05');

  describe('device with completed revisions', () => {
    it('should calculate overdue based on last completed revision + interval', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-1',
        revisionIntervalMonths: 12,
        lastCompletedDate: '2024-01-15', // ~2 years ago
        today,
      });

      expect(result.isOverdue).toBe(true);
      expect(result.neverServiced).toBe(false);
      expect(result.nextDueDate).toBe('2025-01-15');
      expect(result.overdueDays).toBeGreaterThan(365); // more than 1 year overdue
    });

    it('should not be overdue if within interval', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-2',
        revisionIntervalMonths: 12,
        lastCompletedDate: '2025-06-01', // 8 months ago
        today,
      });

      expect(result.isOverdue).toBe(false);
      expect(result.neverServiced).toBe(false);
      expect(result.nextDueDate).toBe('2026-06-01');
      expect(result.overdueDays).toBe(0);
    });

    it('should handle 24-month interval', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-3',
        revisionIntervalMonths: 24,
        lastCompletedDate: '2024-06-01', // 20 months ago
        today,
      });

      expect(result.isOverdue).toBe(false); // 24 months = June 2026, not yet
      expect(result.nextDueDate).toBe('2026-06-01');
    });

    it('should handle 36-month interval', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-4',
        revisionIntervalMonths: 36,
        lastCompletedDate: '2020-02-05', // exactly 6 years ago
        today,
      });

      expect(result.isOverdue).toBe(true);
      // Should be 3 years overdue (last completed + 36 months = Feb 2023)
      expect(result.nextDueDate).toBe('2023-02-05');
      expect(result.overdueDays).toBeGreaterThan(1000);
    });
  });

  describe('device without completed revisions (never serviced)', () => {
    it('should mark device as never serviced', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-5',
        revisionIntervalMonths: 12,
        lastCompletedDate: null,
        today,
      });

      expect(result.isOverdue).toBe(false);
      expect(result.neverServiced).toBe(true);
      expect(result.nextDueDate).toBe(null);
      expect(result.overdueDays).toBe(0);
    });

    it('should mark as never serviced even with planned revisions', () => {
      // This simulates the case from the user's screenshot:
      // 3 revisions exist but all are "planned", none completed
      const result = calculateOverdueInfo({
        deviceId: 'device-6',
        revisionIntervalMonths: 24,
        lastCompletedDate: null, // no completed revisions
        today,
      });

      expect(result.neverServiced).toBe(true);
      expect(result.isOverdue).toBe(false);
    });
  });

  describe('device with installation date but no completed revisions', () => {
    it('should calculate overdue from installation date if no completed revision', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-7',
        revisionIntervalMonths: 12,
        lastCompletedDate: null,
        installationDate: '2020-09-05', // installed 5+ years ago
        today,
      });

      // If we use installation date as fallback:
      // Device installed Sep 2020, interval 12 months = due Sep 2021
      // Now Feb 2026 = very overdue
      expect(result.isOverdue).toBe(true);
      expect(result.neverServiced).toBe(true); // still mark as never serviced
      expect(result.overdueFromInstallation).toBe(true);
    });

    it('should not be overdue if installed recently and never serviced', () => {
      const result = calculateOverdueInfo({
        deviceId: 'device-8',
        revisionIntervalMonths: 12,
        lastCompletedDate: null,
        installationDate: '2025-10-01', // installed 4 months ago
        today,
      });

      expect(result.isOverdue).toBe(false);
      expect(result.neverServiced).toBe(true);
      // Due Oct 2026, not overdue yet
    });
  });
});

describe('integration: customer overdue status', () => {
  const today = new Date('2026-02-05');

  it('should correctly identify customer with never-serviced devices', () => {
    // Customer has 2 devices:
    // - Krb (0 revisions) - never serviced
    // - Komín (3 planned revisions, none completed) - never serviced
    
    const devices = [
      { id: 'krb', revisionIntervalMonths: 36, lastCompletedDate: null, installationDate: '2016-06-27' },
      { id: 'komin', revisionIntervalMonths: 24, lastCompletedDate: null, installationDate: '2020-09-05' },
    ];

    const results = devices.map(d => calculateOverdueInfo({
      deviceId: d.id,
      revisionIntervalMonths: d.revisionIntervalMonths,
      lastCompletedDate: d.lastCompletedDate,
      installationDate: d.installationDate,
      today,
    }));

    // Both should be marked as never serviced
    expect(results.every(r => r.neverServiced)).toBe(true);
    
    // Both are overdue from installation date
    expect(results.every(r => r.isOverdue)).toBe(true);
  });
});
