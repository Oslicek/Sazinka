/**
 * Phase 2 — LocalStorageAdapter tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalStorageAdapter } from '../adapters/LocalStorageAdapter';
import { makeEnvelope, type HydrationContext } from '../core/types';

const CTX: HydrationContext = { userId: 'u1' };

describe('LocalStorageAdapter', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    localStorage.clear();
    adapter = new LocalStorageAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('channelId is local', () => {
    expect(adapter.channelId).toBe('local');
  });

  it('write stores envelope as JSON, read parses it back', () => {
    const env = makeEnvelope('local-value', 'local');
    adapter.write('my-key', env, CTX);
    const result = adapter.read('my-key', CTX);
    expect(result?.value).toBe('local-value');
  });

  it('quota exceeded on write is handled gracefully (no throw)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => adapter.write('key', makeEnvelope('x', 'local'), CTX)).not.toThrow();
  });

  it('storage access denied on read is handled gracefully (returns null)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('Access denied');
    });
    expect(() => adapter.read('key', CTX)).not.toThrow();
    expect(adapter.read('key', CTX)).toBeNull();
  });

  it('corrupt JSON returns null', () => {
    localStorage.setItem('bad', '{ bad json');
    expect(adapter.read('bad', CTX)).toBeNull();
  });

  it('wrong envelope version returns null', () => {
    localStorage.setItem('v2', JSON.stringify({ v: 2, ts: Date.now(), value: 'x', source: 'local' }));
    expect(adapter.read('v2', CTX)).toBeNull();
  });
});
