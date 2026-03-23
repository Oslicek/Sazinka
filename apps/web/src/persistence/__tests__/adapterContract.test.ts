/**
 * Phase 2 — Shared adapter contract tests.
 *
 * These tests run against every adapter implementation to verify they all
 * satisfy the same contract: read/write/remove, graceful error handling,
 * and namespace isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEnvelope, type PersistenceAdapter, type HydrationContext } from '../core/types';
import { MemoryAdapter } from '../adapters/MemoryAdapter';
import { SessionStorageAdapter } from '../adapters/SessionStorageAdapter';
import { LocalStorageAdapter } from '../adapters/LocalStorageAdapter';

const CTX: HydrationContext = { userId: 'u1' };
const KEY = 'test-key';

function runContractSuite(name: string, factory: () => PersistenceAdapter) {
  describe(`${name} — adapter contract`, () => {
    let adapter: PersistenceAdapter;

    beforeEach(() => {
      adapter = factory();
    });

    it('read returns null for unknown key', () => {
      expect(adapter.read('no-such-key', CTX)).toBeNull();
    });

    it('write then read returns the stored value', () => {
      const env = makeEnvelope('hello', adapter.channelId);
      adapter.write(KEY, env, CTX);
      const result = adapter.read(KEY, CTX);
      expect(result?.value).toBe('hello');
    });

    it('write then remove then read returns null', () => {
      const env = makeEnvelope('to-remove', adapter.channelId);
      adapter.write(KEY, env, CTX);
      adapter.remove(KEY, CTX);
      expect(adapter.read(KEY, CTX)).toBeNull();
    });

    it('remove on non-existent key does not throw', () => {
      expect(() => adapter.remove('no-such-key', CTX)).not.toThrow();
    });

    it('overwrite: second write replaces first', () => {
      adapter.write(KEY, makeEnvelope('first', adapter.channelId), CTX);
      adapter.write(KEY, makeEnvelope('second', adapter.channelId), CTX);
      expect(adapter.read(KEY, CTX)?.value).toBe('second');
    });

    it('different keys are independent', () => {
      adapter.write('key-a', makeEnvelope('a', adapter.channelId), CTX);
      adapter.write('key-b', makeEnvelope('b', adapter.channelId), CTX);
      expect(adapter.read('key-a', CTX)?.value).toBe('a');
      expect(adapter.read('key-b', CTX)?.value).toBe('b');
    });

    it('corrupt stored payload returns null and does not throw', () => {
      // Simulate corruption by writing raw invalid data (storage-level test)
      // For adapters that use JSON, inject corrupt data directly
      if (name === 'SessionStorageAdapter') {
        sessionStorage.setItem(KEY, '{ not valid json !!!');
        expect(() => adapter.read(KEY, CTX)).not.toThrow();
        expect(adapter.read(KEY, CTX)).toBeNull();
      } else if (name === 'LocalStorageAdapter') {
        localStorage.setItem(KEY, '{ not valid json !!!');
        expect(() => adapter.read(KEY, CTX)).not.toThrow();
        expect(adapter.read(KEY, CTX)).toBeNull();
      } else {
        // MemoryAdapter: inject raw invalid data
        (adapter as MemoryAdapter).writeRaw(KEY, 'not-an-envelope');
        expect(() => adapter.read(KEY, CTX)).not.toThrow();
        expect(adapter.read(KEY, CTX)).toBeNull();
      }
    });

    it('storage unavailable (throws on access) is handled gracefully', () => {
      // Simulate storage throwing (private browsing mode, quota, etc.)
      if (name === 'SessionStorageAdapter') {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
          throw new Error('Storage unavailable');
        });
        expect(() => adapter.read(KEY, CTX)).not.toThrow();
        expect(adapter.read(KEY, CTX)).toBeNull();
      } else if (name === 'LocalStorageAdapter') {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
          throw new Error('Storage unavailable');
        });
        expect(() => adapter.read(KEY, CTX)).not.toThrow();
        expect(adapter.read(KEY, CTX)).toBeNull();
      }
      // MemoryAdapter never throws — no mock needed
    });
  });
}

// Run the contract suite against all adapter implementations
runContractSuite('MemoryAdapter', () => new MemoryAdapter('session'));
runContractSuite('SessionStorageAdapter', () => {
  sessionStorage.clear();
  return new SessionStorageAdapter();
});
runContractSuite('LocalStorageAdapter', () => {
  localStorage.clear();
  return new LocalStorageAdapter();
});
