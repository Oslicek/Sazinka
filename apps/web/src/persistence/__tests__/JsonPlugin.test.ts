/**
 * Phase 3 — JsonPlugin tests.
 */
import { describe, it, expect } from 'vitest';
import { JsonPlugin } from '../plugins/JsonPlugin';

interface Filter {
  type: string;
  value: string;
}

describe('JsonPlugin', () => {
  const plugin = new JsonPlugin<Filter>({ type: 'all', value: '' });

  it('encode serializes object to JSON string', () => {
    const result = plugin.encode({ type: 'overdue', value: 'test' });
    expect(typeof result).toBe('string');
    expect(JSON.parse(result)).toEqual({ type: 'overdue', value: 'test' });
  });

  it('decode parses JSON string to object', () => {
    const raw = JSON.stringify({ type: 'overdue', value: 'test' });
    expect(plugin.decode(raw)).toEqual({ type: 'overdue', value: 'test' });
  });

  it('decode returns null for corrupt JSON', () => {
    expect(plugin.decode('{ bad json')).toBeNull();
  });

  it('decode returns null for null', () => {
    expect(plugin.decode(null)).toBeNull();
  });

  it('decode returns null for undefined', () => {
    expect(plugin.decode(undefined)).toBeNull();
  });

  it('decode returns null for empty string', () => {
    expect(plugin.decode('')).toBeNull();
  });

  it('decode handles nested objects', () => {
    const obj = { type: 'complex', value: 'x', nested: { a: 1 } };
    const result = plugin.decode(JSON.stringify(obj));
    expect(result).toEqual(obj);
  });

  it('normalize returns the value unchanged', () => {
    const val = { type: 'all', value: '' };
    expect(plugin.normalize(val)).toEqual(val);
  });

  it('isEmpty returns true for null', () => {
    expect(plugin.isEmpty(null)).toBe(true);
  });

  it('isEmpty returns false for non-null object', () => {
    expect(plugin.isEmpty({ type: 'all', value: '' })).toBe(false);
  });

  it('equals returns true for deep-equal objects', () => {
    expect(plugin.equals({ type: 'a', value: 'b' }, { type: 'a', value: 'b' })).toBe(true);
  });

  it('equals returns false for different objects', () => {
    expect(plugin.equals({ type: 'a', value: 'b' }, { type: 'c', value: 'd' })).toBe(false);
  });

  it('round-trip: encode then decode', () => {
    const val = { type: 'overdue', value: 'test' };
    expect(plugin.decode(plugin.encode(val))).toEqual(val);
  });

  it('large payload does not throw', () => {
    const large = { type: 'test', value: 'x'.repeat(100_000) };
    expect(() => plugin.encode(large)).not.toThrow();
    expect(() => plugin.decode(plugin.encode(large))).not.toThrow();
  });
});
