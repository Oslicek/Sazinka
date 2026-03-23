/**
 * In-memory adapter for testing.
 * Provides direct raw access for test setup.
 */
import {
  makeEnvelope,
  isValidEnvelope,
  type ChannelId,
  type PersistenceEnvelope,
  type PersistenceAdapter,
  type HydrationContext,
} from '../core/types';

export class MemoryAdapter implements PersistenceAdapter {
  readonly channelId: ChannelId;
  private store = new Map<string, PersistenceEnvelope<unknown>>();

  constructor(channelId: ChannelId) {
    this.channelId = channelId;
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

  /** Direct raw access for test setup — bypasses validation. */
  writeRaw(key: string, envelope: unknown): void {
    this.store.set(key, envelope as PersistenceEnvelope<unknown>);
  }

  readRaw(key: string): PersistenceEnvelope<unknown> | null {
    return this.store.get(key) ?? null;
  }

  clear(): void {
    this.store.clear();
  }

  /** Convenience: write a value directly (creates envelope). */
  set(key: string, value: unknown): void {
    this.store.set(key, makeEnvelope(value, this.channelId));
  }
}
