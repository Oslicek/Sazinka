import { isValidEnvelope, type ChannelId, type PersistenceEnvelope, type PersistenceAdapter, type HydrationContext } from '../core/types';

export class SessionStorageAdapter implements PersistenceAdapter {
  readonly channelId: ChannelId = 'session';

  read(key: string, _ctx: HydrationContext): PersistenceEnvelope<unknown> | null {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      return isValidEnvelope(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  write(key: string, envelope: PersistenceEnvelope<unknown>, _ctx: HydrationContext): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(envelope));
    } catch {
      // Quota exceeded or access denied — silently ignore
    }
  }

  remove(key: string, _ctx: HydrationContext): void {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Silently ignore
    }
  }

  subscribe(
    key: string,
    listener: (envelope: PersistenceEnvelope<unknown> | null) => void,
  ): () => void {
    const handler = (event: StorageEvent) => {
      if (event.storageArea !== sessionStorage || event.key !== key) return;
      if (event.newValue === null) {
        listener(null);
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        listener(isValidEnvelope(parsed) ? parsed : null);
      } catch {
        listener(null);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}
