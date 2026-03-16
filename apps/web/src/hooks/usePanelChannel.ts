import { useEffect, useRef } from 'react';
import type { PanelState } from '../types/panelState';

export interface PanelChannelMessage {
  type: 'STATE_UPDATE' | 'HELLO' | 'HELLO_REPLY';
  senderId: string;
  payload?: Partial<PanelState>;
}

const CHANNEL_NAME = 'sazinka-inbox';

function diffState(prev: PanelState, next: PanelState): Partial<PanelState> | null {
  const changed: Partial<PanelState> = {};
  let hasChanges = false;

  for (const key of Object.keys(next) as (keyof PanelState)[]) {
    if (prev[key] !== next[key]) {
      (changed as Record<string, unknown>)[key] = next[key];
      hasChanges = true;
    }
  }

  return hasChanges ? changed : null;
}

export function usePanelChannel(
  enabled: boolean,
  state: PanelState,
  dispatch: (partial: Partial<PanelState>) => void
): void {
  const senderIdRef = useRef(crypto.randomUUID());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const prevStateRef = useRef<PanelState>(state);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (e: MessageEvent) => {
      const msg = e.data as PanelChannelMessage;
      if (msg.senderId === senderIdRef.current) return;
      if (msg.type === 'STATE_UPDATE' && msg.payload) {
        dispatchRef.current(msg.payload);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    if (!enabled || !channelRef.current) return;

    const diff = diffState(prev, state);
    if (diff) {
      channelRef.current.postMessage({
        type: 'STATE_UPDATE' as const,
        senderId: senderIdRef.current,
        payload: diff,
      } as PanelChannelMessage);
    }
  }, [enabled, state]);
}
