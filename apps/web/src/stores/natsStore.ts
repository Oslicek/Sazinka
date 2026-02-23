import { create } from 'zustand';
import { connect, NatsConnection, JSONCodec } from 'nats.ws';
import { logger } from '../utils/logger';
import i18n from '@/i18n';

interface NatsState {
  connection: NatsConnection | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  
  // Actions
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  request: <TReq, TRes>(subject: string, payload: TReq, timeoutMs?: number) => Promise<TRes>;
  subscribe: <T>(subject: string, callback: (msg: T) => void) => Promise<() => void>;
}

const codec = JSONCodec();

export const useNatsStore = create<NatsState>((set, get) => ({
  connection: null,
  isConnected: false,
  isConnecting: false,
  error: null,

  connect: async (url: string) => {
    const state = get();
    if (state.isConnected || state.isConnecting) return;

    set({ isConnecting: true, error: null });

    try {
      const nc = await connect({
        servers: url,
        user: import.meta.env.VITE_NATS_USER,
        pass: import.meta.env.VITE_NATS_PASS,
        reconnect: true,
        maxReconnectAttempts: -1, // Unlimited
        reconnectTimeWait: 2000,
      });

      set({ connection: nc, isConnected: true, isConnecting: false });

      // Handle connection events
      (async () => {
        for await (const status of nc.status()) {
          switch (status.type) {
            case 'disconnect':
              set({ isConnected: false });
              break;
            case 'reconnect':
              set({ isConnected: true, error: null });
              break;
            case 'error':
              set({ error: status.data?.toString() || i18n.t('common:errors.connection_error') });
              break;
          }
        }
      })();

    } catch (error) {
      set({
        isConnecting: false,
        error: error instanceof Error ? error.message : i18n.t('common:errors.failed_to_connect'),
      });
    }
  },

  disconnect: async () => {
    const { connection } = get();
    if (connection) {
      await connection.close();
      set({ connection: null, isConnected: false });
    }
  },

  request: async <TReq, TRes>(
    subject: string,
    payload: TReq,
    timeoutMs = 10000
  ): Promise<TRes> => {
    const { connection, isConnected } = get();

    if (!connection || !isConnected) {
      throw new Error(i18n.t('common:errors.not_connected'));
    }

    try {
      const msg = await connection.request(
        subject,
        codec.encode(payload),
        { timeout: timeoutMs }
      );

      const response = codec.decode(msg.data) as TRes;
      return response;
    } catch (error) {
      // Handle NATS-specific errors with user-friendly messages
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('503') || message.includes('no responders')) {
          throw new Error(i18n.t('common:errors.server_unavailable'));
        }
        if (message.includes('timeout') || message.includes('timed out')) {
          throw new Error(i18n.t('common:errors.request_timeout'));
        }
      }
      throw error;
    }
  },

  subscribe: async <T>(
    subject: string,
    callback: (msg: T) => void
  ): Promise<() => void> => {
    const { connection, isConnected } = get();

    if (!connection || !isConnected) {
      throw new Error(i18n.t('common:errors.not_connected'));
    }

    const sub = connection.subscribe(subject);
    
    // Process messages in background
    (async () => {
      for await (const msg of sub) {
        try {
          const data = codec.decode(msg.data) as T;
          callback(data);
        } catch (error) {
          logger.error('Failed to decode message:', error);
        }
      }
    })();

    // Return unsubscribe function
    return () => {
      sub.unsubscribe();
    };
  },
}));

// Auto-connect on module load (in development)
if (typeof window !== 'undefined') {
  const wsUrl = import.meta.env.VITE_NATS_WS_URL;
  useNatsStore.getState().connect(wsUrl);
}
