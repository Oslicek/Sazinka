/**
 * Server preferences adapter.
 *
 * Fetches user preferences from a remote source (NATS or REST).
 * Uses an injected fetchPreferences function so it can be tested without
 * real network calls.
 *
 * Usage:
 *   1. Call load(ctx) once on app startup (or on user login).
 *   2. read() is synchronous after load() completes.
 */
import { makeEnvelope, isValidEnvelope, type ChannelId, type PersistenceEnvelope, type PersistenceAdapter, type HydrationContext } from '../core/types';

export interface ServerPreferencesAdapterOptions {
  fetchPreferences: (ctx: HydrationContext) => Promise<Partial<Record<string, unknown>>>;
  timeoutMs?: number;
}

export class ServerPreferencesAdapter implements PersistenceAdapter {
  readonly channelId: ChannelId = 'server';
  private store = new Map<string, PersistenceEnvelope<unknown>>();
  private fetchPreferences: ServerPreferencesAdapterOptions['fetchPreferences'];
  private timeoutMs: number;

  constructor({ fetchPreferences, timeoutMs = 5000 }: ServerPreferencesAdapterOptions) {
    this.fetchPreferences = fetchPreferences;
    this.timeoutMs = timeoutMs;
  }

  async load(ctx: HydrationContext): Promise<void> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ServerPreferencesAdapter timeout')), this.timeoutMs),
      );
      const data = await Promise.race([this.fetchPreferences(ctx), timeoutPromise]);
      for (const [key, value] of Object.entries(data)) {
        this.store.set(key, makeEnvelope(value, 'server'));
      }
    } catch {
      // Failure or timeout — leave store empty, orchestrator falls back to next channel
    }
  }

  read(key: string, _ctx: HydrationContext): PersistenceEnvelope<unknown> | null {
    const env = this.store.get(key) ?? null;
    return isValidEnvelope(env) ? env : null;
  }

  write(key: string, envelope: PersistenceEnvelope<unknown>, _ctx: HydrationContext): void {
    this.store.set(key, envelope);
  }

  remove(key: string, _ctx: HydrationContext): void {
    this.store.delete(key);
  }
}
