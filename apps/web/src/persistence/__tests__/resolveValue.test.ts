/**
 * Phase P1 — resolveValue tests.
 *
 * Verifies nullish-safe precedence: undefined/null fall through,
 * falsy-but-valid values (false, 0, '') are preserved.
 */
import { describe, it, expect } from 'vitest';
import { resolveValue } from '../react/resolveValue';

describe('resolveValue', () => {
  it('returns first defined value', () => {
    expect(resolveValue('url', 'upp', 'default')).toBe('url');
  });

  it('preserves false (does not fall through to next candidate)', () => {
    expect(resolveValue(false, true, true)).toBe(false);
  });

  it('preserves empty string where valid', () => {
    expect(resolveValue('', 'upp', 'default')).toBe('');
  });

  it('preserves 0 (no falsy loss)', () => {
    expect(resolveValue(0, 99, 99)).toBe(0);
  });

  it('null falls through to next candidate', () => {
    expect(resolveValue(null, 'upp', 'default')).toBe('upp');
  });

  it('undefined falls through to next candidate', () => {
    expect(resolveValue(undefined, 'upp', 'default')).toBe('upp');
  });

  it('all candidates undefined returns final fallback', () => {
    expect(resolveValue(undefined, undefined, 'fallback')).toBe('fallback');
  });

  it('null in middle falls through to next', () => {
    expect(resolveValue(null, null, 'last')).toBe('last');
  });

  it('works with two candidates', () => {
    expect(resolveValue(undefined, 'second')).toBe('second');
  });

  it('works with single candidate', () => {
    expect(resolveValue('only')).toBe('only');
  });
});
