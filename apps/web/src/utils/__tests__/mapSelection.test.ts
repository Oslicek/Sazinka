import { describe, it, expect } from 'vitest';
import { toggleMapSelectedId, mergeMapSelectedIds } from '../mapSelection';

describe('toggleMapSelectedId', () => {
  it('adds id when not present', () => {
    expect(toggleMapSelectedId(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('removes id when already present', () => {
    expect(toggleMapSelectedId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('works on empty array', () => {
    expect(toggleMapSelectedId([], 'x')).toEqual(['x']);
  });

  it('works when toggling the only element', () => {
    expect(toggleMapSelectedId(['x'], 'x')).toEqual([]);
  });
});

describe('mergeMapSelectedIds', () => {
  it('merges without duplicates', () => {
    expect(mergeMapSelectedIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('handles empty current', () => {
    expect(mergeMapSelectedIds([], ['x', 'y'])).toEqual(['x', 'y']);
  });

  it('handles empty incoming', () => {
    expect(mergeMapSelectedIds(['a'], [])).toEqual(['a']);
  });

  it('handles both empty', () => {
    expect(mergeMapSelectedIds([], [])).toEqual([]);
  });

  it('preserves order of existing + new', () => {
    const result = mergeMapSelectedIds(['a', 'b'], ['c', 'a']);
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('c'));
  });
});
