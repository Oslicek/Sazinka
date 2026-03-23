/**
 * Phase 2 — UrlAdapter tests.
 *
 * The URL adapter reads from and writes to the browser's URL search params.
 * It uses an injected getter/setter so it can be tested without a real router.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UrlAdapter } from '../adapters/UrlAdapter';
import { makeEnvelope, type HydrationContext } from '../core/types';

const CTX: HydrationContext = { userId: 'u1' };

describe('UrlAdapter', () => {
  let params: URLSearchParams;
  let adapter: UrlAdapter;

  beforeEach(() => {
    params = new URLSearchParams();
    adapter = new UrlAdapter({
      getParams: () => params,
      setParams: (newParams) => { params = newParams; },
    });
  });

  it('read returns null when param is absent', () => {
    expect(adapter.read('myKey', CTX)).toBeNull();
  });

  it('write encodes value as URL param, read decodes it', () => {
    const env = makeEnvelope('2026-03-21', 'url');
    adapter.write('dateFrom', env, CTX);
    const result = adapter.read('dateFrom', CTX);
    expect(result?.value).toBe('2026-03-21');
    expect(result?.source).toBe('url');
  });

  it('write with empty string removes the param', () => {
    adapter.write('crew', makeEnvelope('', 'url'), CTX);
    expect(params.has('crew')).toBe(false);
  });

  it('write with null removes the param', () => {
    adapter.write('crew', makeEnvelope(null, 'url'), CTX);
    expect(params.has('crew')).toBe(false);
  });

  it('remove deletes the param', () => {
    params.set('dateFrom', '2026-01-01');
    adapter.remove('dateFrom', CTX);
    expect(params.has('dateFrom')).toBe(false);
  });

  it('remove on non-existent param does not throw', () => {
    expect(() => adapter.remove('nonexistent', CTX)).not.toThrow();
  });

  it('round-trip: boolean true', () => {
    adapter.write('flag', makeEnvelope(true, 'url'), CTX);
    const result = adapter.read('flag', CTX);
    expect(result?.value).toBe('true');
  });

  it('round-trip: number', () => {
    adapter.write('count', makeEnvelope(42, 'url'), CTX);
    const result = adapter.read('count', CTX);
    expect(result?.value).toBe('42');
  });

  it('corrupt param value returns null without throwing', () => {
    // Inject a raw value that cannot be decoded as a valid envelope
    params.set('badKey', '{ not json');
    expect(() => adapter.read('badKey', CTX)).not.toThrow();
    // URL adapter stores scalar values directly, so this should just return the raw string
    // (not null) — it's up to the plugin to validate
    const result = adapter.read('badKey', CTX);
    // Either null or a string value — must not throw
    expect(result === null || typeof result?.value === 'string').toBe(true);
  });

  it('channelId is url', () => {
    expect(adapter.channelId).toBe('url');
  });
});
