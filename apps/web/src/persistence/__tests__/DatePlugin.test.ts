/**
 * Phase 3 — DatePlugin tests.
 */
import { describe, it, expect } from 'vitest';
import { DatePlugin } from '../plugins/DatePlugin';

const plugin = new DatePlugin();

describe('DatePlugin', () => {
  it('encode returns the string as-is', () => {
    expect(plugin.encode('2026-03-21')).toBe('2026-03-21');
  });

  it('decode returns valid date string unchanged', () => {
    expect(plugin.decode('2026-03-21')).toBe('2026-03-21');
  });

  it('decode returns null for invalid date string', () => {
    expect(plugin.decode('not-a-date')).toBeNull();
  });

  it('decode returns null for empty string', () => {
    expect(plugin.decode('')).toBeNull();
  });

  it('decode returns null for null', () => {
    expect(plugin.decode(null)).toBeNull();
  });

  it('decode returns null for undefined', () => {
    expect(plugin.decode(undefined)).toBeNull();
  });

  it('decode returns null for non-ISO format (DD/MM/YYYY)', () => {
    expect(plugin.decode('21/03/2026')).toBeNull();
  });

  it('normalize returns the date string unchanged', () => {
    expect(plugin.normalize('2026-03-21')).toBe('2026-03-21');
  });

  it('isEmpty returns true for null', () => {
    expect(plugin.isEmpty(null)).toBe(true);
  });

  it('isEmpty returns true for empty string', () => {
    expect(plugin.isEmpty('')).toBe(true);
  });

  it('isEmpty returns false for valid date', () => {
    expect(plugin.isEmpty('2026-03-21')).toBe(false);
  });

  it('equals returns true for same date', () => {
    expect(plugin.equals('2026-03-21', '2026-03-21')).toBe(true);
  });

  it('equals returns false for different dates', () => {
    expect(plugin.equals('2026-03-21', '2026-03-22')).toBe(false);
  });

  it('equals returns true for both null', () => {
    expect(plugin.equals(null, null)).toBe(true);
  });

  it('round-trip: encode then decode', () => {
    const date = '2026-06-15';
    expect(plugin.decode(plugin.encode(date))).toBe(date);
  });
});
