/**
 * Phase 2 — ServerPreferencesAdapter tests.
 *
 * Uses an injected fetch function so no real NATS/network calls are made.
 * Tests cover: resolve, reject, timeout, and no uncaught promise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerPreferencesAdapter } from '../adapters/ServerPreferencesAdapter';
import { makeEnvelope, makeKey, type HydrationContext } from '../core/types';

const CTX: HydrationContext = { userId: 'u1' };

describe('ServerPreferencesAdapter', () => {
  let adapter: ServerPreferencesAdapter;

  it('channelId is server', () => {
    const a = new ServerPreferencesAdapter({ fetchPreferences: vi.fn().mockResolvedValue({}) });
    expect(a.channelId).toBe('server');
  });

  it('read returns null synchronously (server is async — must be pre-loaded)', () => {
    adapter = new ServerPreferencesAdapter({ fetchPreferences: vi.fn().mockResolvedValue({}) });
    expect(adapter.read('any-key', CTX)).toBeNull();
  });

  it('load() resolves preferences and read returns the stored value', async () => {
    const key = makeKey({ userId: 'u1', profileId: 'plan.filters', controlId: 'dateFrom' });
    const mockFetch = vi.fn().mockResolvedValue({ [key]: '2026-03-21' });
    adapter = new ServerPreferencesAdapter({ fetchPreferences: mockFetch });

    await adapter.load(CTX);

    const result = adapter.read(key, CTX);
    expect(result?.value).toBe('2026-03-21');
    expect(result?.source).toBe('server');
  });

  it('load() on fetch rejection does not throw, read returns null', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    adapter = new ServerPreferencesAdapter({ fetchPreferences: mockFetch });

    await expect(adapter.load(CTX)).resolves.not.toThrow();
    expect(adapter.read('any-key', CTX)).toBeNull();
  });

  it('load() on fetch timeout does not throw, read returns null', async () => {
    const mockFetch = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10)),
    );
    adapter = new ServerPreferencesAdapter({ fetchPreferences: mockFetch, timeoutMs: 5 });

    await expect(adapter.load(CTX)).resolves.not.toThrow();
    expect(adapter.read('any-key', CTX)).toBeNull();
  });

  it('write stores value in memory (for optimistic updates)', () => {
    adapter = new ServerPreferencesAdapter({ fetchPreferences: vi.fn().mockResolvedValue({}) });
    const env = makeEnvelope('stored', 'server');
    adapter.write('my-key', env, CTX);
    expect(adapter.read('my-key', CTX)?.value).toBe('stored');
  });

  it('remove clears a stored value', () => {
    adapter = new ServerPreferencesAdapter({ fetchPreferences: vi.fn().mockResolvedValue({}) });
    adapter.write('my-key', makeEnvelope('x', 'server'), CTX);
    adapter.remove('my-key', CTX);
    expect(adapter.read('my-key', CTX)).toBeNull();
  });

  it('no uncaught promise rejection when fetch fails', async () => {
    const errors: unknown[] = [];
    const handler = (e: PromiseRejectionEvent) => errors.push(e.reason);
    window.addEventListener('unhandledrejection', handler);

    const mockFetch = vi.fn().mockRejectedValue(new Error('Unhandled'));
    adapter = new ServerPreferencesAdapter({ fetchPreferences: mockFetch });
    await adapter.load(CTX);

    // Give microtasks a chance to propagate
    await new Promise((r) => setTimeout(r, 10));
    window.removeEventListener('unhandledrejection', handler);

    expect(errors).toHaveLength(0);
  });
});
