/**
 * legacySeed — legacy storage key reader.
 *
 * Reads a raw (non-UPP-namespaced) key from sessionStorage or localStorage
 * and returns the parsed value. Used for one-time migration seeding.
 *
 * Rules:
 * - Returns undefined when key is absent.
 * - Returns undefined for corrupt/unparseable JSON (no throw).
 * - Parses boolean strings 'true'/'false' to booleans.
 * - Returns plain strings as-is when not valid JSON.
 * - Returns parsed object/array/number for valid JSON.
 */
export function readLegacyKey(
  channel: 'session' | 'local',
  key: string,
): unknown {
  const storage = channel === 'session' ? sessionStorage : localStorage;
  const raw = storage.getItem(key);

  if (raw === null) return undefined;

  // Boolean string shortcuts
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Try JSON parse
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // If it looks like JSON (starts with { or [) but failed to parse, treat as corrupt
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return undefined;
    }
    // Plain string — return as-is
    return raw;
  }
}
