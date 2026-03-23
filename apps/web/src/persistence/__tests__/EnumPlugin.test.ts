/**
 * Phase 3 — EnumPlugin tests.
 */
import { describe, it, expect } from 'vitest';
import { EnumPlugin } from '../plugins/EnumPlugin';

describe('EnumPlugin', () => {
  const plugin = new EnumPlugin(['asc', 'desc'], 'asc');

  it('decode returns value when it is in the allowed set', () => {
    expect(plugin.decode('asc')).toBe('asc');
    expect(plugin.decode('desc')).toBe('desc');
  });

  it('decode returns default for unknown value', () => {
    expect(plugin.decode('random')).toBe('asc');
  });

  it('decode returns default for null', () => {
    expect(plugin.decode(null)).toBe('asc');
  });

  it('decode returns default for undefined', () => {
    expect(plugin.decode(undefined)).toBe('asc');
  });

  it('encode returns the value as-is', () => {
    expect(plugin.encode('desc')).toBe('desc');
  });

  it('normalize returns the value unchanged when valid', () => {
    expect(plugin.normalize('asc')).toBe('asc');
  });

  it('normalize returns default when value is invalid', () => {
    expect(plugin.normalize('invalid')).toBe('asc');
  });

  it('isEmpty returns true for empty string', () => {
    const p = new EnumPlugin(['', 'overdue', 'week'], '');
    expect(p.isEmpty('')).toBe(true);
  });

  it('isEmpty returns false for non-empty value', () => {
    expect(plugin.isEmpty('asc')).toBe(false);
  });

  it('equals returns true for same value', () => {
    expect(plugin.equals('asc', 'asc')).toBe(true);
  });

  it('equals returns false for different values', () => {
    expect(plugin.equals('asc', 'desc')).toBe(false);
  });

  it('allows empty string as valid enum value', () => {
    const p = new EnumPlugin(['', 'overdue', 'week', 'month'], '');
    expect(p.decode('')).toBe('');
    expect(p.decode('overdue')).toBe('overdue');
    expect(p.decode('month')).toBe('month');
    expect(p.decode('bad')).toBe('');
  });
});
