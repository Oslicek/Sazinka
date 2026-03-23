/**
 * Precedence resolution for the UPP hydration pipeline.
 *
 * Channel priority (highest to lowest): url > session > local > server
 * Within the same channel priority, newest timestamp wins.
 */
import { isValidEnvelope, type PersistenceEnvelope, type ChannelId } from './types';

const CHANNEL_PRIORITY: Record<ChannelId, number> = {
  url: 0,
  session: 1,
  local: 2,
  server: 3,
};

export function resolvePrecedence(
  envelopes: PersistenceEnvelope<unknown>[],
): PersistenceEnvelope<unknown> | null {
  const valid = envelopes.filter(isValidEnvelope);
  if (valid.length === 0) return null;

  return valid.reduce((best, current) => {
    const bestPriority = CHANNEL_PRIORITY[best.source] ?? Infinity;
    const currentPriority = CHANNEL_PRIORITY[current.source] ?? Infinity;

    if (currentPriority < bestPriority) return current;
    if (currentPriority === bestPriority && current.ts > best.ts) return current;
    return best;
  });
}
