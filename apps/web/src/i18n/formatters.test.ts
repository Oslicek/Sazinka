import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  formatDate,
  formatTime,
  formatNumber,
  formatDistance,
  formatDuration,
  formatRelativeTime,
  getWeekdayNames,
  getMonthNames,
} from './formatters';

// Create a test i18n instance for formatters
const testI18n = i18n.createInstance();

beforeAll(async () => {
  await testI18n
    .use(initReactI18next)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'cs'],
      ns: ['common'],
      defaultNS: 'common',
      resources: {
        en: { common: {} },
        cs: { common: {} },
      },
      interpolation: { escapeValue: false },
    });
});

describe('formatDate', () => {
  it('should format date in short style for English', () => {
    const result = formatDate('2026-03-15', 'short', 'en');
    expect(result).toMatch(/3\/15\/2026|Mar 15, 2026|15\/03\/2026/);
  });

  it('should format date in short style for Czech', () => {
    const result = formatDate('2026-03-15', 'short', 'cs');
    expect(result).toMatch(/15/);
    expect(result).toMatch(/3|03/);
  });

  it('should format date in long style', () => {
    const result = formatDate('2026-03-15', 'long', 'en');
    expect(result).toMatch(/March/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2026/);
  });

  it('should handle Date objects', () => {
    const result = formatDate(new Date(2026, 2, 15), 'short', 'en');
    expect(result).toMatch(/3\/15\/2026|Mar 15, 2026|15\/03\/2026/);
  });
});

describe('formatTime', () => {
  it('should format time for English (12h)', () => {
    const result = formatTime('2026-03-15T14:30:00', 'en');
    expect(result).toMatch(/2:30\s*PM/i);
  });

  it('should format time for Czech (24h)', () => {
    const result = formatTime('2026-03-15T14:30:00', 'cs');
    expect(result).toMatch(/14:30/);
  });

  it('should handle HH:MM string input', () => {
    const result = formatTime('14:30', 'cs');
    expect(result).toMatch(/14:30/);
  });
});

describe('formatNumber', () => {
  it('should format number for English', () => {
    const result = formatNumber(1234.5, 1, 'en');
    expect(result).toBe('1,234.5');
  });

  it('should format number for Czech', () => {
    const result = formatNumber(1234.5, 1, 'cs');
    // Czech uses non-breaking space as thousands separator and comma as decimal
    expect(result).toMatch(/1[\s\u00a0]234,5/);
  });

  it('should respect decimal places', () => {
    const result = formatNumber(1234.567, 2, 'en');
    expect(result).toBe('1,234.57');
  });

  it('should format integers without decimals', () => {
    const result = formatNumber(1234, 0, 'en');
    expect(result).toBe('1,234');
  });
});

describe('formatDistance', () => {
  it('should format distance for English', () => {
    const result = formatDistance(12.3, 'en');
    expect(result).toBe('12.3 km');
  });

  it('should format distance for Czech', () => {
    const result = formatDistance(12.3, 'cs');
    expect(result).toMatch(/12,3\s*km/);
  });
});

describe('formatDuration', () => {
  it('should format minutes only', () => {
    const result = formatDuration(45);
    expect(result).toBe('45min');
  });

  it('should format hours and minutes', () => {
    const result = formatDuration(125);
    expect(result).toBe('2h 05min');
  });

  it('should format exact hours', () => {
    const result = formatDuration(120);
    expect(result).toBe('2h');
  });

  it('should handle zero', () => {
    const result = formatDuration(0);
    expect(result).toBe('0min');
  });

  it('should handle negative values', () => {
    const result = formatDuration(-10);
    expect(result).toBe('0min');
  });
});

describe('formatRelativeTime', () => {
  it('should return a string containing time reference for English', () => {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const result = formatRelativeTime(oneHourAgo, 'en');
    expect(result).toMatch(/hour|hr/i);
  });

  it('should return a string containing time reference for Czech', () => {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const result = formatRelativeTime(oneHourAgo, 'cs');
    // Czech: "před 1 hodinou" or similar
    expect(result).toMatch(/hodin/i);
  });
});

describe('getWeekdayNames', () => {
  it('should return 7 weekday names', () => {
    const names = getWeekdayNames('short', 'en');
    expect(names).toHaveLength(7);
  });

  it('should start with Monday', () => {
    const names = getWeekdayNames('long', 'en');
    expect(names[0]).toBe('Monday');
  });

  it('should return Czech weekday names', () => {
    const names = getWeekdayNames('long', 'cs');
    expect(names[0]).toMatch(/pondělí/i);
  });

  it('should return short names', () => {
    const names = getWeekdayNames('short', 'en');
    expect(names[0]).toMatch(/Mon/i);
  });
});

describe('getMonthNames', () => {
  it('should return 12 month names', () => {
    const names = getMonthNames('long', 'en');
    expect(names).toHaveLength(12);
  });

  it('should start with January', () => {
    const names = getMonthNames('long', 'en');
    expect(names[0]).toBe('January');
  });

  it('should return Czech month names', () => {
    const names = getMonthNames('long', 'cs');
    expect(names[0]).toMatch(/leden/i);
  });

  it('should return short names', () => {
    const names = getMonthNames('short', 'en');
    expect(names[0]).toMatch(/Jan/i);
  });
});
