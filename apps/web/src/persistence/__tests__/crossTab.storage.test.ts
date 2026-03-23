/**
 * Phase 2 — Cross-tab / storage event tests.
 *
 * Verifies that rapid synthetic storage events do not cause unbounded writes
 * or infinite subscribe loops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionStorageAdapter } from '../adapters/SessionStorageAdapter';
import { LocalStorageAdapter } from '../adapters/LocalStorageAdapter';
import { makeEnvelope, type HydrationContext } from '../core/types';

const CTX: HydrationContext = { userId: 'u1' };
const KEY = 'test-cross-tab-key';

function fireStorageEvent(key: string, newValue: string | null, storage: Storage) {
  const event = new StorageEvent('storage', {
    key,
    newValue,
    storageArea: storage,
  });
  window.dispatchEvent(event);
}

describe('cross-tab storage events', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('SessionStorageAdapter subscribe calls listener when storage event fires', () => {
    const adapter = new SessionStorageAdapter();
    const listener = vi.fn();

    const unsubscribe = adapter.subscribe?.(KEY, listener);
    expect(unsubscribe).toBeDefined();

    const env = makeEnvelope('new-value', 'session');
    sessionStorage.setItem(KEY, JSON.stringify(env));
    fireStorageEvent(KEY, JSON.stringify(env), sessionStorage);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe?.();
  });

  it('LocalStorageAdapter subscribe calls listener when storage event fires', () => {
    const adapter = new LocalStorageAdapter();
    const listener = vi.fn();

    const unsubscribe = adapter.subscribe?.(KEY, listener);
    expect(unsubscribe).toBeDefined();

    const env = makeEnvelope('local-new', 'local');
    localStorage.setItem(KEY, JSON.stringify(env));
    fireStorageEvent(KEY, JSON.stringify(env), localStorage);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe?.();
  });

  it('unsubscribe stops receiving storage events', () => {
    const adapter = new SessionStorageAdapter();
    const listener = vi.fn();

    const unsubscribe = adapter.subscribe?.(KEY, listener);
    unsubscribe?.();

    const env = makeEnvelope('after-unsub', 'session');
    sessionStorage.setItem(KEY, JSON.stringify(env));
    fireStorageEvent(KEY, JSON.stringify(env), sessionStorage);

    expect(listener).not.toHaveBeenCalled();
  });

  it('N rapid storage events produce exactly N listener calls (no infinite loop)', () => {
    const adapter = new SessionStorageAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe?.(KEY, listener);

    const N = 20;
    for (let i = 0; i < N; i++) {
      const env = makeEnvelope(`value-${i}`, 'session');
      sessionStorage.setItem(KEY, JSON.stringify(env));
      fireStorageEvent(KEY, JSON.stringify(env), sessionStorage);
    }

    expect(listener).toHaveBeenCalledTimes(N);
    unsubscribe?.();
  });

  it('storage event for different key does not trigger listener', () => {
    const adapter = new SessionStorageAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe?.(KEY, listener);

    const env = makeEnvelope('other', 'session');
    sessionStorage.setItem('other-key', JSON.stringify(env));
    fireStorageEvent('other-key', JSON.stringify(env), sessionStorage);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe?.();
  });

  it('storage event with null newValue calls listener with null', () => {
    const adapter = new SessionStorageAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe?.(KEY, listener);

    fireStorageEvent(KEY, null, sessionStorage);

    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe?.();
  });
});
