/**
 * Phase 1 — Precedence function tests.
 *
 * Verifies that the hydration precedence pipeline produces deterministic
 * results across all channel combinations.
 */
import { describe, it, expect } from 'vitest';
import { resolvePrecedence } from '../core/precedence';
import { makeEnvelope, type PersistenceEnvelope, type ChannelId } from '../core/types';

function env<T>(value: T, source: ChannelId, tsOffset = 0): PersistenceEnvelope<T> {
  return { v: 1, ts: Date.now() + tsOffset, value, source };
}

describe('resolvePrecedence', () => {
  it('returns null when no envelopes provided', () => {
    expect(resolvePrecedence([])).toBeNull();
  });

  it('URL wins over session, local, and server', () => {
    const result = resolvePrecedence([
      env('from-server', 'server'),
      env('from-local', 'local'),
      env('from-session', 'session'),
      env('from-url', 'url'),
    ]);
    expect(result?.value).toBe('from-url');
  });

  it('session wins over local and server when no URL', () => {
    const result = resolvePrecedence([
      env('from-server', 'server'),
      env('from-local', 'local'),
      env('from-session', 'session'),
    ]);
    expect(result?.value).toBe('from-session');
  });

  it('local wins over server when no URL or session', () => {
    const result = resolvePrecedence([
      env('from-server', 'server'),
      env('from-local', 'local'),
    ]);
    expect(result?.value).toBe('from-local');
  });

  it('server is used when it is the only source', () => {
    const result = resolvePrecedence([env('from-server', 'server')]);
    expect(result?.value).toBe('from-server');
  });

  it('unknown channel is ignored, no crash', () => {
    const badEnv = { v: 1, ts: Date.now(), value: 'bad', source: 'unknown' as ChannelId };
    const result = resolvePrecedence([badEnv, env('from-url', 'url')]);
    expect(result?.value).toBe('from-url');
  });

  it('tie-breaker: newest timestamp wins within same channel priority', () => {
    const older = env('old', 'session', -1000);
    const newer = env('new', 'session', 0);
    const result = resolvePrecedence([older, newer]);
    expect(result?.value).toBe('new');
  });

  it('tie-breaker: older timestamp loses within same channel priority', () => {
    const older = env('old', 'local', -5000);
    const newer = env('new', 'local', 0);
    const result = resolvePrecedence([older, newer]);
    expect(result?.value).toBe('new');
  });

  it('invalid envelope (wrong version) is ignored', () => {
    const bad = { v: 99, ts: Date.now(), value: 'bad', source: 'url' } as unknown as PersistenceEnvelope<string>;
    const good = env('good', 'session');
    const result = resolvePrecedence([bad, good]);
    expect(result?.value).toBe('good');
  });

  it('URL valid + session valid + different values → URL wins (golden case)', () => {
    const result = resolvePrecedence([
      env('2025-01-01', 'url'),
      env('2024-06-15', 'session'),
    ]);
    expect(result?.value).toBe('2025-01-01');
    expect(result?.source).toBe('url');
  });

  it('URL invalid + session valid → session wins (golden case)', () => {
    const badUrl = { v: 99, ts: Date.now(), value: 'bad', source: 'url' } as unknown as PersistenceEnvelope<string>;
    const goodSession = env('2024-06-15', 'session');
    const result = resolvePrecedence([badUrl, goodSession]);
    expect(result?.value).toBe('2024-06-15');
    expect(result?.source).toBe('session');
  });

  it('returns the envelope itself, not just the value', () => {
    const e = env('test-value', 'local');
    const result = resolvePrecedence([e]);
    expect(result).toEqual(e);
  });
});
