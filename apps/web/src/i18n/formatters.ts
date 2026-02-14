/**
 * Locale-aware formatting utilities using native Intl APIs.
 *
 * All functions accept an optional `locale` parameter. When omitted,
 * they fall back to `i18n.language` (the active i18next locale).
 */
import i18n from './index';

function resolveLocale(locale?: string): string {
  return locale ?? i18n.language ?? 'en';
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/**
 * Format a date string or Date object.
 * @param date  ISO date string (YYYY-MM-DD or full ISO) or Date object
 * @param style 'short' = numeric, 'long' = with month name
 */
export function formatDate(
  date: string | Date,
  style: 'short' | 'long' = 'short',
  locale?: string,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const loc = resolveLocale(locale);

  if (style === 'long') {
    return d.toLocaleDateString(loc, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return d.toLocaleDateString(loc, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * Format a time value.
 * @param time  ISO datetime string, or HH:MM string
 */
export function formatTime(time: string, locale?: string): string {
  const loc = resolveLocale(locale);

  // Handle HH:MM shorthand
  if (/^\d{2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(2026, 0, 1, h, m);
    return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  }

  const d = new Date(time);
  return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/**
 * Format a number with locale-appropriate separators.
 * @param value         The number to format
 * @param decimals      Number of decimal places
 */
export function formatNumber(
  value: number,
  decimals: number = 0,
  locale?: string,
): string {
  const loc = resolveLocale(locale);
  return new Intl.NumberFormat(loc, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Distance formatting
// ---------------------------------------------------------------------------

/**
 * Format a distance in kilometers.
 */
export function formatDistance(km: number, locale?: string): string {
  return `${formatNumber(km, 1, locale)} km`;
}

// ---------------------------------------------------------------------------
// Duration formatting (locale-independent, compact)
// ---------------------------------------------------------------------------

/**
 * Format minutes as compact duration string: "45min", "2h 05min", "2h".
 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm.toString().padStart(2, '0')}min`;
}

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

/**
 * Format a date as relative time (e.g. "2 hours ago", "před 2 hodinami").
 */
export function formatRelativeTime(date: Date, locale?: string): string {
  const loc = resolveLocale(locale);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
  return rtf.format(diffDay, 'day');
}

// ---------------------------------------------------------------------------
// Weekday / Month name arrays
// ---------------------------------------------------------------------------

/**
 * Get localized weekday names starting from Monday.
 */
export function getWeekdayNames(
  style: 'short' | 'long' = 'long',
  locale?: string,
): string[] {
  const loc = resolveLocale(locale);
  // 2024-01-01 is a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i);
    return d.toLocaleDateString(loc, { weekday: style });
  });
}

/**
 * Get localized month names (January..December).
 */
export function getMonthNames(
  style: 'short' | 'long' = 'long',
  locale?: string,
): string[] {
  const loc = resolveLocale(locale);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2024, i, 1);
    return d.toLocaleDateString(loc, { month: style });
  });
}
