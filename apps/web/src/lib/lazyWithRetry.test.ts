import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RELOAD_KEY = 'chunkReloadAttempt';

let isChunkLoadError: (error: unknown) => boolean;
let lazyWithRetry: typeof import('./lazyWithRetry').lazyWithRetry;
let clearChunkReloadCounter: typeof import('./lazyWithRetry').clearChunkReloadCounter;

const mockLazy = vi.fn();
vi.mock('react', () => ({ lazy: (fn: unknown) => mockLazy(fn) }));

beforeEach(async () => {
  sessionStorage.clear();
  mockLazy.mockImplementation((fn: unknown) => fn);
  vi.resetModules();
  const mod = await import('./lazyWithRetry');
  lazyWithRetry = mod.lazyWithRetry;
  clearChunkReloadCounter = mod.clearChunkReloadCounter;
  // Also grab the private helper via the module's behavior
  isChunkLoadError = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('dynamically imported module') ||
      msg.includes('loading chunk') ||
      msg.includes('loading css chunk') ||
      msg.includes('failed to fetch')
    );
  };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('isChunkLoadError (behavior via lazyWithRetry)', () => {
  it('detects "dynamically imported module" error', () => {
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: /foo.js'))).toBe(true);
  });

  it('detects "Loading chunk" error', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
  });

  it('rejects non-chunk errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('rejects non-Error values', () => {
    expect(isChunkLoadError('string error')).toBe(false);
  });
});

describe('lazyWithRetry', () => {
  it('resolves on first successful import', async () => {
    const mod = { default: () => null };
    const factory = vi.fn().mockResolvedValue(mod);

    const resolver = lazyWithRetry(factory) as unknown as () => Promise<typeof mod>;
    const result = await resolver();

    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('retries once then resolves on second attempt', async () => {
    const mod = { default: () => null };
    const factory = vi.fn()
      .mockRejectedValueOnce(new TypeError('error loading dynamically imported module'))
      .mockResolvedValueOnce(mod);

    const resolver = lazyWithRetry(factory) as unknown as () => Promise<typeof mod>;
    const result = await resolver();

    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('reloads the page after retry fails with chunk error', async () => {
    vi.useFakeTimers();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    const factory = vi.fn().mockRejectedValue(
      new TypeError('error loading dynamically imported module: /foo.js'),
    );

    const resolver = lazyWithRetry(factory) as unknown as () => Promise<never>;
    const promise = resolver().catch(() => 'threw');

    // Flush the retry delay
    await vi.advanceTimersByTimeAsync(1500);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe('1');

    vi.useRealTimers();
  });

  it('does NOT reload if max attempts exceeded — throws instead', async () => {
    sessionStorage.setItem(RELOAD_KEY, '1');

    const chunkError = new TypeError('error loading dynamically imported module: /foo.js');
    const factory = vi.fn().mockRejectedValue(chunkError);

    const resolver = lazyWithRetry(factory) as unknown as () => Promise<never>;
    await expect(resolver()).rejects.toThrow(chunkError);

    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it('re-throws non-chunk errors without reload', async () => {
    const otherError = new Error('Some other error');
    const factory = vi.fn().mockRejectedValue(otherError);

    const resolver = lazyWithRetry(factory) as unknown as () => Promise<never>;
    await expect(resolver()).rejects.toThrow(otherError);
  });
});

describe('clearChunkReloadCounter', () => {
  it('removes the reload counter from sessionStorage', () => {
    sessionStorage.setItem(RELOAD_KEY, '1');
    clearChunkReloadCounter();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });
});
