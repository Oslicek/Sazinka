export interface InboxSearch {
  customerId?: string;
}

/**
 * Validates and normalises the raw URL search params for the /inbox route.
 * - Keeps `customerId` only when it is a non-empty string after trimming.
 * - Drops unknown keys.
 */
export function validateInboxSearch(raw: Record<string, unknown>): InboxSearch {
  const result: InboxSearch = {};

  if (typeof raw.customerId === 'string') {
    const trimmed = raw.customerId.trim();
    if (trimmed) {
      result.customerId = trimmed;
    }
  }

  return result;
}
