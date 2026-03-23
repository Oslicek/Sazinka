/**
 * Phase 1 — Type contract tests.
 *
 * Verifies that the core types and interfaces are correctly shaped and
 * that the envelope format is enforced at runtime.
 */
import { describe, it, expect } from 'vitest';
import {
  makeEnvelope,
  isValidEnvelope,
  makeKey,
  type PersistenceEnvelope,
  type ChannelId,
} from '../core/types';

describe('PersistenceEnvelope', () => {
  it('makeEnvelope creates a v1 envelope with correct shape', () => {
    const before = Date.now();
    const env = makeEnvelope('hello', 'url');
    const after = Date.now();

    expect(env.v).toBe(1);
    expect(env.value).toBe('hello');
    expect(env.source).toBe('url');
    expect(env.ts).toBeGreaterThanOrEqual(before);
    expect(env.ts).toBeLessThanOrEqual(after);
  });

  it('isValidEnvelope returns true for a well-formed envelope', () => {
    const env: PersistenceEnvelope<string> = {
      v: 1,
      ts: Date.now(),
      value: 'test',
      source: 'session',
    };
    expect(isValidEnvelope(env)).toBe(true);
  });

  it('isValidEnvelope returns false for wrong version', () => {
    const env = { v: 2, ts: Date.now(), value: 'x', source: 'local' };
    expect(isValidEnvelope(env as unknown as PersistenceEnvelope<unknown>)).toBe(false);
  });

  it('isValidEnvelope returns false for null', () => {
    expect(isValidEnvelope(null as unknown as PersistenceEnvelope<unknown>)).toBe(false);
  });

  it('isValidEnvelope returns false for missing fields', () => {
    expect(isValidEnvelope({ v: 1 } as unknown as PersistenceEnvelope<unknown>)).toBe(false);
  });

  it('isValidEnvelope returns false for unknown source', () => {
    const env = { v: 1, ts: Date.now(), value: 'x', source: 'unknown_channel' };
    expect(isValidEnvelope(env as unknown as PersistenceEnvelope<unknown>)).toBe(false);
  });

  it('makeEnvelope accepts all valid channel ids', () => {
    const channels: ChannelId[] = ['url', 'session', 'local', 'server'];
    for (const ch of channels) {
      const env = makeEnvelope(42, ch);
      expect(env.source).toBe(ch);
    }
  });
});

describe('makeKey', () => {
  it('produces a namespaced key', () => {
    const key = makeKey({ userId: 'u1', profileId: 'plan.filters', controlId: 'dateFrom' });
    expect(key).toBe('sazinka:persist:v1:user:u1:profile:plan.filters:control:dateFrom');
  });

  it('different users produce different keys', () => {
    const k1 = makeKey({ userId: 'alice', profileId: 'p', controlId: 'c' });
    const k2 = makeKey({ userId: 'bob', profileId: 'p', controlId: 'c' });
    expect(k1).not.toBe(k2);
  });

  it('different profiles produce different keys', () => {
    const k1 = makeKey({ userId: 'u', profileId: 'plan.filters', controlId: 'c' });
    const k2 = makeKey({ userId: 'u', profileId: 'routes.filters', controlId: 'c' });
    expect(k1).not.toBe(k2);
  });

  it('different controls produce different keys', () => {
    const k1 = makeKey({ userId: 'u', profileId: 'p', controlId: 'dateFrom' });
    const k2 = makeKey({ userId: 'u', profileId: 'p', controlId: 'dateTo' });
    expect(k1).not.toBe(k2);
  });
});
