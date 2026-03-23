/**
 * Phase 2 — SessionStorageAdapter tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStorageAdapter } from '../adapters/SessionStorageAdapter';
import { makeEnvelope, makeKey, type HydrationContext } from '../core/types';

const CTX: HydrationContext = { userId: 'u1' };

describe('SessionStorageAdapter', () => {
  let adapter: SessionStorageAdapter;

  beforeEach(() => {
    sessionStorage.clear();
    adapter = new SessionStorageAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('channelId is session', () => {
    expect(adapter.channelId).toBe('session');
  });

  it('write stores envelope as JSON, read parses it back', () => {
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });
    const env = makeEnvelope('test-value', 'session');
    adapter.write(key, env, CTX);

    const raw = sessionStorage.getItem(key);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).value).toBe('test-value');

    const result = adapter.read(key, CTX);
    expect(result?.value).toBe('test-value');
  });

  it('quota exceeded on write is handled gracefully (no throw)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError');
    });
    const env = makeEnvelope('x', 'session');
    expect(() => adapter.write('key', env, CTX)).not.toThrow();
  });

  it('storage access denied on read is handled gracefully (returns null)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('Access denied');
    });
    expect(() => adapter.read('key', CTX)).not.toThrow();
    expect(adapter.read('key', CTX)).toBeNull();
  });

  it('corrupt JSON in storage returns null', () => {
    sessionStorage.setItem('bad-key', '{ not valid json');
    expect(adapter.read('bad-key', CTX)).toBeNull();
  });

  it('envelope with wrong version is ignored (returns null)', () => {
    sessionStorage.setItem('old-key', JSON.stringify({ v: 99, ts: Date.now(), value: 'x', source: 'session' }));
    expect(adapter.read('old-key', CTX)).toBeNull();
  });
});
