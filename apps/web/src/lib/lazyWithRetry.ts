import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'chunkReloadAttempt';
const MAX_RELOADS = 1;

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('failed to fetch')
  );
}

/**
 * Wraps React.lazy() with a single retry and, if still failing, a guarded
 * page reload. Covers the scenario where Cloudflare Access session expiry
 * causes chunk fetches to redirect to an HTML login page (MIME mismatch).
 *
 * A sessionStorage counter prevents infinite reload loops: after one reload
 * attempt the app falls through to the normal ErrorBoundary.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((firstError: unknown) => {
      return new Promise<{ default: T }>((resolve) => setTimeout(resolve, 1000))
        .then(() => factory())
        .catch((retryError: unknown) => {
          if (!isChunkLoadError(retryError)) throw retryError;

          const attempts = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
          if (attempts >= MAX_RELOADS) {
            sessionStorage.removeItem(RELOAD_KEY);
            throw retryError;
          }

          sessionStorage.setItem(RELOAD_KEY, String(attempts + 1));
          window.location.reload();
          return new Promise<never>(() => {});
        });
    }),
  );
}

/**
 * Clear the reload counter. Call from main.tsx on successful app mount
 * so a stale counter from a previous failure doesn't block future reloads.
 */
export function clearChunkReloadCounter(): void {
  sessionStorage.removeItem(RELOAD_KEY);
}
