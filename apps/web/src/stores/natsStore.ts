import { create } from 'zustand';
import { connect, NatsConnection, JSONCodec, Subscription } from 'nats.ws';

interface NatsState {
  connection: NatsConnection | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  
  // Actions
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  request: <TReq, TRes>(subject: string, payload: TReq, timeoutMs?: number) => Promise<TRes>;
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
              set({ error: status.data?.toString() || 'Connection error' });
              break;
          }
        }
      })();

    } catch (error) {
      set({
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Failed to connect',
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
      throw new Error('Not connected to NATS');
    }

    const msg = await connection.request(
      subject,
      codec.encode(payload),
      { timeout: timeoutMs }
    );

    const response = codec.decode(msg.data) as TRes;
    return response;
  },
}));

// Auto-connect on module load (in development)
if (typeof window !== 'undefined') {
  const wsUrl = import.meta.env.VITE_NATS_WS_URL || 'ws://localhost:8222';
  useNatsStore.getState().connect(wsUrl);
}
