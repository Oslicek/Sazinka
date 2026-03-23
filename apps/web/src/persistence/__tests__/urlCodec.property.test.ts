/**
 * Phase 3 — URL codec property/fuzz tests (C25).
 *
 * Hand-rolled fuzz loop (no fast-check dependency).
 * Verifies that encoding arbitrary strings as URL params never throws
 * and round-trips safely.
 */
import { describe, it, expect } from 'vitest';
import { UrlAdapter } from '../adapters/UrlAdapter';
import { makeEnvelope, type HydrationContext } from '../core/types';

const CTX: HydrationContext = { userId: 'u1' };

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()-_=+[]{}|;:,.<>?/`~"\'\\';

function randomString(maxLen = 200): string {
  const len = Math.floor(Math.random() * maxLen);
  return Array.from({ length: len }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

describe('UrlAdapter — property/fuzz', () => {
  it('encode/decode never throws for random ASCII strings (100 iterations)', () => {
    for (let i = 0; i < 100; i++) {
      const value = randomString();
      let params = new URLSearchParams();
      const adapter = new UrlAdapter({
        getParams: () => params,
        setParams: (p) => { params = p; },
      });

      expect(() => {
        adapter.write('key', makeEnvelope(value, 'url'), CTX);
        adapter.read('key', CTX);
      }).not.toThrow();
    }
  });

  it('non-empty strings round-trip through URL params', () => {
    // Use only URL-safe characters for round-trip test
    const safeChars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < 50; i++) {
      const len = 1 + Math.floor(Math.random() * 50);
      const value = Array.from({ length: len }, () =>
        safeChars[Math.floor(Math.random() * safeChars.length)],
      ).join('');

      let params = new URLSearchParams();
      const adapter = new UrlAdapter({
        getParams: () => params,
        setParams: (p) => { params = p; },
      });

      adapter.write('key', makeEnvelope(value, 'url'), CTX);
      const result = adapter.read('key', CTX);
      // URL adapter stores as string — value should match
      expect(result?.value).toBe(value);
    }
  });
});
