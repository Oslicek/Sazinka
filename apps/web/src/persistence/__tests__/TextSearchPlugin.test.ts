/**
 * Phase 3 — TextSearchPlugin tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextSearchPlugin } from '../plugins/TextSearchPlugin';

describe('TextSearchPlugin', () => {
  let plugin: TextSearchPlugin;

  beforeEach(() => {
    vi.useFakeTimers();
    plugin = new TextSearchPlugin({ debounceMs: 300 });
  });

  it('decode returns string unchanged', () => {
    expect(plugin.decode('hello')).toBe('hello');
  });

  it('decode returns empty string for null', () => {
    expect(plugin.decode(null)).toBe('');
  });

  it('decode returns empty string for undefined', () => {
    expect(plugin.decode(undefined)).toBe('');
  });

  it('encode returns trimmed string', () => {
    expect(plugin.encode('  hello  ')).toBe('hello');
  });

  it('encode returns empty string for empty input', () => {
    expect(plugin.encode('')).toBe('');
  });

  it('normalize trims whitespace', () => {
    expect(plugin.normalize('  test  ')).toBe('test');
  });

  it('isEmpty returns true for empty string', () => {
    expect(plugin.isEmpty('')).toBe(true);
  });

  it('isEmpty returns false for non-empty string', () => {
    expect(plugin.isEmpty('hello')).toBe(false);
  });

  it('equals returns true for same string', () => {
    expect(plugin.equals('hello', 'hello')).toBe(true);
  });

  it('equals returns false for different strings', () => {
    expect(plugin.equals('hello', 'world')).toBe(false);
  });

  it('debounce: callback fires after debounceMs', () => {
    const cb = vi.fn();
    plugin.debounce('search-term', cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledWith('search-term');
  });

  it('debounce: rapid calls only fire once', () => {
    const cb = vi.fn();
    plugin.debounce('a', cb);
    plugin.debounce('ab', cb);
    plugin.debounce('abc', cb);
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('abc');
  });

  it('debounce: cancel stops pending call', () => {
    const cb = vi.fn();
    plugin.debounce('hello', cb);
    plugin.cancel();
    vi.advanceTimersByTime(300);
    expect(cb).not.toHaveBeenCalled();
  });

  it('debounce: flush calls immediately with last value', () => {
    const cb = vi.fn();
    plugin.debounce('pending', cb);
    plugin.flush();
    expect(cb).toHaveBeenCalledWith('pending');
  });
});
