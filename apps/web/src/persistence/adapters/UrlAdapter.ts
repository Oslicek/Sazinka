/**
 * URL adapter — reads/writes from URL search params.
 *
 * Uses injected getter/setter so it can be tested without a real router.
 * Values are stored as plain strings in the URL (no envelope wrapper in the
 * URL itself); the envelope is synthesized on read.
 */
import { makeEnvelope, type ChannelId, type PersistenceEnvelope, type PersistenceAdapter, type HydrationContext } from '../core/types';

export interface UrlAdapterOptions {
  getParams: () => URLSearchParams;
  setParams: (params: URLSearchParams) => void;
}

export class UrlAdapter implements PersistenceAdapter {
  readonly channelId: ChannelId = 'url';
  private getParams: () => URLSearchParams;
  private setParams: (params: URLSearchParams) => void;

  constructor({ getParams, setParams }: UrlAdapterOptions) {
    this.getParams = getParams;
    this.setParams = setParams;
  }

  read(key: string, _ctx: HydrationContext): PersistenceEnvelope<unknown> | null {
    try {
      const params = this.getParams();
      const raw = params.get(key);
      if (raw === null) return null;
      return makeEnvelope(raw, 'url');
    } catch {
      return null;
    }
  }

  write(key: string, envelope: PersistenceEnvelope<unknown>, _ctx: HydrationContext): void {
    try {
      const params = new URLSearchParams(this.getParams().toString());
      const value = envelope.value;
      if (value === null || value === undefined || value === '') {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
      this.setParams(params);
    } catch {
      // Silently ignore
    }
  }

  remove(key: string, _ctx: HydrationContext): void {
    try {
      const params = new URLSearchParams(this.getParams().toString());
      params.delete(key);
      this.setParams(params);
    } catch {
      // Silently ignore
    }
  }
}
