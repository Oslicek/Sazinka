/**
 * Phase 3 — BooleanPlugin tests (C38).
 *
 * Covers encode/decode round-trip, legacy string formats from old storage,
 * URL param encoding, and isEmpty semantics.
 */
import { describe, it, expect } from 'vitest';
import { BooleanPlugin } from '../plugins/BooleanPlugin';

describe('BooleanPlugin', () => {
  const plugin = new BooleanPlugin(false);

  it('decode returns true for boolean true', () => {
    expect(plugin.decode(true)).toBe(true);
  });

  it('decode returns false for boolean false', () => {
    expect(plugin.decode(false)).toBe(false);
  });

  it('decode returns true for string "true" (legacy storage)', () => {
    expect(plugin.decode('true')).toBe(true);
  });

  it('decode returns false for string "false" (legacy storage)', () => {
    expect(plugin.decode('false')).toBe(false);
  });

  it('decode returns true for string "1" (URL param)', () => {
    expect(plugin.decode('1')).toBe(true);
  });

  it('decode returns false for string "0" (URL param)', () => {
    expect(plugin.decode('0')).toBe(false);
  });

  it('decode returns default for null', () => {
    expect(plugin.decode(null)).toBe(false);
  });

  it('decode returns default for undefined', () => {
    expect(plugin.decode(undefined)).toBe(false);
  });

  it('decode returns default for unrecognized string', () => {
    expect(plugin.decode('yes')).toBe(false);
  });

  it('encode returns boolean value', () => {
    expect(plugin.encode(true)).toBe(true);
    expect(plugin.encode(false)).toBe(false);
  });

  it('normalize returns boolean unchanged', () => {
    expect(plugin.normalize(true)).toBe(true);
    expect(plugin.normalize(false)).toBe(false);
  });

  it('isEmpty returns true for null', () => {
    expect(plugin.isEmpty(null)).toBe(true);
  });

  it('isEmpty returns true for undefined', () => {
    expect(plugin.isEmpty(undefined)).toBe(true);
  });

  it('isEmpty returns false for false (false is a valid non-empty value)', () => {
    expect(plugin.isEmpty(false)).toBe(false);
  });

  it('isEmpty returns false for true', () => {
    expect(plugin.isEmpty(true)).toBe(false);
  });

  it('equals returns true for same boolean', () => {
    expect(plugin.equals(true, true)).toBe(true);
    expect(plugin.equals(false, false)).toBe(true);
  });

  it('equals returns false for different booleans', () => {
    expect(plugin.equals(true, false)).toBe(false);
  });

  it('round-trip: encode then decode', () => {
    expect(plugin.decode(plugin.encode(true))).toBe(true);
    expect(plugin.decode(plugin.encode(false))).toBe(false);
  });

  it('default value is respected when true', () => {
    const trueDefault = new BooleanPlugin(true);
    expect(trueDefault.decode(null)).toBe(true);
    expect(trueDefault.decode(undefined)).toBe(true);
  });
});
