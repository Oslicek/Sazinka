import { useEffect, useRef } from 'react';
import type { PanelSignal, PanelSignalEnvelope } from '../types/panelSignals';

const CHANNEL_NAME = 'sazinka-panels';

export interface UsePanelSignalsOptions {
  enabled: boolean;
  /** True only on the main window — responds to REQUEST_CONTEXT_SNAPSHOT */
  isSourceOfTruth: boolean;
  /** Called for every signal received from another window */
  onSignal: (signal: PanelSignal) => void;
  /** Required when isSourceOfTruth=true — returns current state for snapshot */
  getSnapshot?: () => Omit<Extract<PanelSignal, { type: 'CONTEXT_SNAPSHOT' }>, 'type'>;
}

export interface UsePanelSignalsReturn {
  sendSignal: (signal: PanelSignal) => void;
}

export function usePanelSignals({
  enabled,
  isSourceOfTruth,
  onSignal,
  getSnapshot,
}: UsePanelSignalsOptions): UsePanelSignalsReturn {
  const senderIdRef = useRef(crypto.randomUUID());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (e: MessageEvent) => {
      const envelope = e.data as PanelSignalEnvelope;
      if (!envelope || envelope.senderId === senderIdRef.current) return;

      const { signal } = envelope;

      if (signal.type === 'REQUEST_CONTEXT_SNAPSHOT') {
        if (isSourceOfTruth && getSnapshotRef.current) {
          const snap = getSnapshotRef.current();
          const response: PanelSignalEnvelope = {
            senderId: senderIdRef.current,
            signal: { type: 'CONTEXT_SNAPSHOT', ...snap },
          };
          channel.postMessage(response);
        }
        return;
      }

      onSignalRef.current(signal);
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [enabled, isSourceOfTruth]);

  const sendSignal = (signal: PanelSignal) => {
    if (!channelRef.current) return;
    const envelope: PanelSignalEnvelope = {
      senderId: senderIdRef.current,
      signal,
    };
    channelRef.current.postMessage(envelope);
  };

  return { sendSignal };
}
