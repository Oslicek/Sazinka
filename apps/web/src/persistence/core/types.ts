/**
 * Core types for the Unified Persistence Platform (UPP).
 */

export type ChannelId = 'url' | 'session' | 'local' | 'server';

const VALID_SOURCES = new Set<string>(['url', 'session', 'local', 'server']);

export interface PersistenceEnvelope<T> {
  v: 1;
  ts: number;
  value: T;
  source: ChannelId;
}

export function makeEnvelope<T>(value: T, source: ChannelId): PersistenceEnvelope<T> {
  return { v: 1, ts: Date.now(), value, source };
}

export function isValidEnvelope(env: unknown): env is PersistenceEnvelope<unknown> {
  if (env === null || typeof env !== 'object') return false;
  const e = env as Record<string, unknown>;
  return (
    e['v'] === 1 &&
    typeof e['ts'] === 'number' &&
    'value' in e &&
    typeof e['source'] === 'string' &&
    VALID_SOURCES.has(e['source'] as string)
  );
}

export interface KeyParams {
  userId: string;
  profileId: string;
  controlId: string;
}

export function makeKey({ userId, profileId, controlId }: KeyParams): string {
  return `sazinka:persist:v1:user:${userId}:profile:${profileId}:control:${controlId}`;
}

export type WriteMode = 'immediate' | 'debounced' | 'onBlur';

export interface ControlSpec<T = unknown> {
  controlId: string;
  pluginId: string;
  defaultValue: T;
  writeMode: WriteMode;
  debounceMs?: number;
  validators: Array<(value: T) => boolean>;
  sanitize?: (value: T) => T;
  legacyKeys?: string[];
}

export interface PersistenceProfile {
  profileId: string;
  controls: ControlSpec[];
  readPriority: ChannelId[];
  writeTargets: ChannelId[];
}

export interface HydrationContext {
  userId: string | null;
}

export type HydratedState = Record<string, unknown>;

export interface PersistenceAdapter {
  readonly channelId: ChannelId;
  read(key: string, ctx: HydrationContext): PersistenceEnvelope<unknown> | null;
  write(key: string, envelope: PersistenceEnvelope<unknown>, ctx: HydrationContext): void;
  remove(key: string, ctx: HydrationContext): void;
  subscribe?(
    key: string,
    listener: (envelope: PersistenceEnvelope<unknown> | null) => void,
  ): () => void;
}
