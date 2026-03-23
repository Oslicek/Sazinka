/**
 * Phase 3 — DateRangePlugin tests.
 *
 * Covers the equal-range vs single-date mode distinction (C39).
 */
import { describe, it, expect } from 'vitest';
import { DateRangePlugin } from '../plugins/DateRangePlugin';

const plugin = new DateRangePlugin();

describe('DateRangePlugin', () => {
  it('encode serializes both dates and isRange flag', () => {
    const encoded = plugin.encode({ dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true });
    expect(typeof encoded).toBe('string');
    const parsed = JSON.parse(encoded);
    expect(parsed.dateFrom).toBe('2026-03-01');
    expect(parsed.dateTo).toBe('2026-03-31');
    expect(parsed.isRange).toBe(true);
  });

  it('decode returns valid range object', () => {
    const raw = JSON.stringify({ dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true });
    const result = plugin.decode(raw);
    expect(result?.dateFrom).toBe('2026-03-01');
    expect(result?.dateTo).toBe('2026-03-31');
    expect(result?.isRange).toBe(true);
  });

  it('decode returns null for corrupt JSON', () => {
    expect(plugin.decode('{ bad json')).toBeNull();
  });

  it('decode returns null for null', () => {
    expect(plugin.decode(null)).toBeNull();
  });

  it('decode returns null for missing dateFrom', () => {
    const raw = JSON.stringify({ dateTo: '2026-03-31', isRange: true });
    expect(plugin.decode(raw)).toBeNull();
  });

  it('decode returns null for invalid dateFrom', () => {
    const raw = JSON.stringify({ dateFrom: 'bad', dateTo: '2026-03-31', isRange: true });
    expect(plugin.decode(raw)).toBeNull();
  });

  it('preserves isRange=false (single-date mode)', () => {
    const raw = JSON.stringify({ dateFrom: '2026-03-15', dateTo: '2026-03-15', isRange: false });
    const result = plugin.decode(raw);
    expect(result?.isRange).toBe(false);
  });

  it('isRange=false with different dateTo: dateTo coerced to dateFrom on normalize', () => {
    const value = { dateFrom: '2026-03-15', dateTo: '2026-03-20', isRange: false };
    const normalized = plugin.normalize(value);
    expect(normalized.dateTo).toBe('2026-03-15');
  });

  it('isRange=true preserves dateTo', () => {
    const value = { dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true };
    const normalized = plugin.normalize(value);
    expect(normalized.dateTo).toBe('2026-03-31');
  });

  it('isEmpty returns true for null', () => {
    expect(plugin.isEmpty(null)).toBe(true);
  });

  it('isEmpty returns false for valid range', () => {
    expect(plugin.isEmpty({ dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true })).toBe(false);
  });

  it('equals returns true for same range', () => {
    const a = { dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true };
    const b = { dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true };
    expect(plugin.equals(a, b)).toBe(true);
  });

  it('equals returns false for different dateFrom', () => {
    const a = { dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true };
    const b = { dateFrom: '2026-03-02', dateTo: '2026-03-31', isRange: true };
    expect(plugin.equals(a, b)).toBe(false);
  });

  it('round-trip: encode then decode', () => {
    const value = { dateFrom: '2026-03-01', dateTo: '2026-03-31', isRange: true };
    const result = plugin.decode(plugin.encode(value));
    expect(result).toEqual(value);
  });
});
