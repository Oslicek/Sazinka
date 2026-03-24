/**
 * Phase P1 — singletons tests.
 *
 * Verifies shared adapter singletons have the correct channelId.
 */
import { describe, it, expect } from 'vitest';
import { sessionAdapter, localAdapter } from '../adapters/singletons';

describe('singletons', () => {
  it('sessionAdapter.channelId === session', () => {
    expect(sessionAdapter.channelId).toBe('session');
  });

  it('localAdapter.channelId === local', () => {
    expect(localAdapter.channelId).toBe('local');
  });

  it('sessionAdapter is a singleton (same reference each import)', async () => {
    const { sessionAdapter: a } = await import('../adapters/singletons');
    const { sessionAdapter: b } = await import('../adapters/singletons');
    expect(a).toBe(b);
  });

  it('localAdapter is a singleton (same reference each import)', async () => {
    const { localAdapter: a } = await import('../adapters/singletons');
    const { localAdapter: b } = await import('../adapters/singletons');
    expect(a).toBe(b);
  });
});
