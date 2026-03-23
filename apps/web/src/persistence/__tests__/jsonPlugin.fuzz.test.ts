/**
 * Phase 3 — JsonPlugin fuzz tests (C26).
 *
 * Verifies that decode never throws for arbitrary inputs and that
 * oversized payloads are handled gracefully.
 */
import { describe, it, expect } from 'vitest';
import { JsonPlugin } from '../plugins/JsonPlugin';

const plugin = new JsonPlugin<unknown>(null);

function randomValue(depth = 0): unknown {
  if (depth > 3) return 'leaf';
  const type = Math.floor(Math.random() * 5);
  switch (type) {
    case 0: return Math.random() * 1000;
    case 1: return Math.random() > 0.5;
    case 2: return `str-${Math.random()}`;
    case 3: return null;
    case 4: {
      const obj: Record<string, unknown> = {};
      const keys = Math.floor(Math.random() * 5);
      for (let i = 0; i < keys; i++) {
        obj[`key${i}`] = randomValue(depth + 1);
      }
      return obj;
    }
    default: return null;
  }
}

describe('JsonPlugin — fuzz', () => {
  it('decode never throws for random JSON-compatible objects (200 iterations)', () => {
    for (let i = 0; i < 200; i++) {
      const obj = randomValue();
      const encoded = JSON.stringify(obj);
      expect(() => plugin.decode(encoded)).not.toThrow();
    }
  });

  it('decode never throws for random garbage strings (200 iterations)', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz{}[]":,0123456789 \n\t\\';
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(Math.random() * 500);
      const garbage = Array.from({ length: len }, () =>
        chars[Math.floor(Math.random() * chars.length)],
      ).join('');
      expect(() => plugin.decode(garbage)).not.toThrow();
    }
  });

  it('oversized payload (100KB) does not throw', () => {
    const large = { data: 'x'.repeat(100_000) };
    const encoded = JSON.stringify(large);
    expect(() => plugin.decode(encoded)).not.toThrow();
  });

  it('decode returns null for non-string, non-null inputs', () => {
    expect(plugin.decode(42 as unknown as string)).toBeNull();
    expect(plugin.decode(true as unknown as string)).toBeNull();
    expect(plugin.decode({} as unknown as string)).toBeNull();
  });
});
