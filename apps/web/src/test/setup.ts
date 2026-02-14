import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Partial mock of react-i18next: provides default useTranslation that returns keys,
// but preserves I18nextProvider and initReactI18next for tests that create their own i18n instance.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: (_ns?: string) => ({
      t: (key: string, _opts?: Record<string, unknown>) => key,
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(),
      },
    }),
  };
});

// Mock i18n module (used by overdueUtils, ErrorBoundary, authStore etc.)
vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, _opts?: Record<string, unknown>) => key,
    language: 'en',
    changeLanguage: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
    on: vi.fn(),
    services: { languageDetector: null },
    hasLoadedNamespace: vi.fn(() => true),
    loadNamespaces: vi.fn(() => Promise.resolve()),
  },
}));

// Mock URL.createObjectURL for jsdom (required by maplibre-gl)
if (typeof window !== 'undefined') {
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url') as typeof window.URL.createObjectURL;
  window.URL.revokeObjectURL = vi.fn();
}

// Mock NATS WebSocket module before any imports
vi.mock('nats.ws', () => {
  const mockConnection = {
    status: vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}), // Never resolves
      }),
    })),
    request: vi.fn(),
    close: vi.fn(),
  };
  
  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
    JSONCodec: vi.fn(() => ({
      encode: vi.fn((data) => new TextEncoder().encode(JSON.stringify(data))),
      decode: vi.fn((data) => JSON.parse(new TextDecoder().decode(data))),
    })),
  };
});

// Prevent auto-connect in tests by mocking the store module
vi.mock('../stores/natsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/natsStore')>();
  return {
    ...actual,
    useNatsStore: {
      ...actual.useNatsStore,
      getState: () => ({
        connection: null,
        isConnected: false,
        isConnecting: false,
        error: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        request: vi.fn(),
      }),
    },
  };
});
