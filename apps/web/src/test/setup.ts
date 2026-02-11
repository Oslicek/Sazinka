import '@testing-library/jest-dom';
import { vi } from 'vitest';

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
