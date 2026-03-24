/**
 * Phase P1 — legacySeed tests.
 *
 * Verifies the legacy key reader handles all edge cases safely.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readLegacyKey } from '../migration/legacySeed';

describe('readLegacyKey', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('parses valid JSON string from sessionStorage and returns parsed object', () => {
    sessionStorage.setItem('planningInbox.filters', JSON.stringify({ crew: 'c1', depot: 'd1' }));
    const result = readLegacyKey('session', 'planningInbox.filters');
    expect(result).toEqual({ crew: 'c1', depot: 'd1' });
  });

  it('returns undefined when key is absent (not present in storage)', () => {
    const result = readLegacyKey('session', 'nonexistent.key');
    expect(result).toBeUndefined();
  });

  it('returns undefined for corrupt/unparseable JSON (no throw)', () => {
    sessionStorage.setItem('bad.key', '{ not valid json');
    const result = readLegacyKey('session', 'bad.key');
    expect(result).toBeUndefined();
  });

  it("parses legacy boolean string 'true' -> true", () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'true');
    const result = readLegacyKey('local', 'planningInbox.enforceDrivingBreakRule');
    expect(result).toBe(true);
  });

  it("parses legacy boolean string 'false' -> false", () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'false');
    const result = readLegacyKey('local', 'planningInbox.enforceDrivingBreakRule');
    expect(result).toBe(false);
  });

  it('parses plain string value (non-JSON) and returns it as-is', () => {
    sessionStorage.setItem('plain.key', 'hello');
    const result = readLegacyKey('session', 'plain.key');
    expect(result).toBe('hello');
  });

  it('reads from localStorage when channel is local', () => {
    localStorage.setItem('local.key', '"stored-in-local"');
    const result = readLegacyKey('local', 'local.key');
    expect(result).toBe('stored-in-local');
  });
});
