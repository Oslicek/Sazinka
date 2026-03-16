import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelSignals } from '../usePanelSignals';
import type { PanelSignalEnvelope } from '../../types/panelSignals';

// ---------------------------------------------------------------------------
// MockBroadcastChannel
// ---------------------------------------------------------------------------

class MockBroadcastChannel {
  name: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  static instances: MockBroadcastChannel[] = [];
  postedMessages: unknown[] = [];
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    this.postedMessages.push(data);
  }

  close() {
    this.closed = true;
  }

  /** Simulate a message arriving from another window */
  simulateReceive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  MockBroadcastChannel.instances = [];
  (global as unknown as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function foreignEnvelope(signal: PanelSignalEnvelope['signal']): PanelSignalEnvelope {
  return { senderId: 'other-window-uuid', signal };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePanelSignals', () => {
  it('does nothing when enabled=false', () => {
    const onSignal = vi.fn();
    renderHook(() =>
      usePanelSignals({ enabled: false, isSourceOfTruth: false, onSignal })
    );
    expect(MockBroadcastChannel.instances).toHaveLength(0);
  });

  it('opens BroadcastChannel("sazinka-panels") when enabled=true', () => {
    renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    expect(MockBroadcastChannel.instances).toHaveLength(1);
    expect(MockBroadcastChannel.instances[0].name).toBe('sazinka-panels');
  });

  it('closes the channel on unmount', () => {
    const { unmount } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    const ch = MockBroadcastChannel.instances[0];
    unmount();
    expect(ch.closed).toBe(true);
  });

  it('sends SELECT_CUSTOMER signal', () => {
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    act(() => {
      result.current.sendSignal({ type: 'SELECT_CUSTOMER', customerId: 'cust-1' });
    });
    const ch = MockBroadcastChannel.instances[0];
    expect(ch.postedMessages).toHaveLength(1);
    const env = ch.postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal).toEqual({ type: 'SELECT_CUSTOMER', customerId: 'cust-1' });
    expect(typeof env.senderId).toBe('string');
  });

  it('sends ROUTE_CONTEXT signal', () => {
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    act(() => {
      result.current.sendSignal({
        type: 'ROUTE_CONTEXT',
        date: '2026-03-10',
        crewId: 'crew-1',
        depotId: 'depot-1',
      });
    });
    const env = MockBroadcastChannel.instances[0].postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal.type).toBe('ROUTE_CONTEXT');
  });

  it('sends SELECT_ROUTE signal', () => {
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    act(() => {
      result.current.sendSignal({ type: 'SELECT_ROUTE', routeId: 'route-42' });
    });
    const env = MockBroadcastChannel.instances[0].postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal).toEqual({ type: 'SELECT_ROUTE', routeId: 'route-42' });
  });

  it('sends HIGHLIGHT_SEGMENT signal', () => {
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    act(() => {
      result.current.sendSignal({ type: 'HIGHLIGHT_SEGMENT', segmentIndex: 3 });
    });
    const env = MockBroadcastChannel.instances[0].postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal).toEqual({ type: 'HIGHLIGHT_SEGMENT', segmentIndex: 3 });
  });

  it('sends PANEL_DETACHED signal', () => {
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    act(() => {
      result.current.sendSignal({ type: 'PANEL_DETACHED', panel: 'map', page: 'inbox' });
    });
    const env = MockBroadcastChannel.instances[0].postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal).toEqual({ type: 'PANEL_DETACHED', panel: 'map', page: 'inbox' });
  });

  it('sends PANEL_REATTACHED signal', () => {
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    act(() => {
      result.current.sendSignal({ type: 'PANEL_REATTACHED', panel: 'list', page: 'inbox' });
    });
    const env = MockBroadcastChannel.instances[0].postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal).toEqual({ type: 'PANEL_REATTACHED', panel: 'list', page: 'inbox' });
  });

  it('receives SELECT_CUSTOMER from another sender and calls onSignal', () => {
    const onSignal = vi.fn();
    renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal })
    );
    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive(foreignEnvelope({ type: 'SELECT_CUSTOMER', customerId: 'cust-99' }));
    });
    expect(onSignal).toHaveBeenCalledWith({ type: 'SELECT_CUSTOMER', customerId: 'cust-99' });
  });

  it('ignores own messages (same senderId)', () => {
    const onSignal = vi.fn();
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal })
    );
    const ch = MockBroadcastChannel.instances[0];
    // Send a signal — capture the senderId from the posted envelope
    act(() => {
      result.current.sendSignal({ type: 'SELECT_CUSTOMER', customerId: 'self' });
    });
    const sentEnvelope = ch.postedMessages[0] as PanelSignalEnvelope;
    // Simulate receiving our own message back
    act(() => {
      ch.simulateReceive(sentEnvelope);
    });
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('handles REQUEST_CONTEXT_SNAPSHOT: source-of-truth window emits CONTEXT_SNAPSHOT', () => {
    const getSnapshot = vi.fn().mockReturnValue({
      routeContext: { date: '2026-03-10', crewId: 'c1', depotId: 'd1' },
      selectedCustomerId: 'cust-1',
      selectedRouteId: null,
      highlightedSegment: null,
    });
    const { result } = renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: true, onSignal: vi.fn(), getSnapshot })
    );
    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive(foreignEnvelope({ type: 'REQUEST_CONTEXT_SNAPSHOT' }));
    });
    expect(ch.postedMessages).toHaveLength(1);
    const env = ch.postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal.type).toBe('CONTEXT_SNAPSHOT');
    if (env.signal.type === 'CONTEXT_SNAPSHOT') {
      expect(env.signal.routeContext?.date).toBe('2026-03-10');
      expect(env.signal.selectedCustomerId).toBe('cust-1');
    }
    // sendSignal should not be needed — we verify result.current exists
    expect(result.current.sendSignal).toBeDefined();
  });

  it('non-source-of-truth window does NOT respond to REQUEST_CONTEXT_SNAPSHOT', () => {
    renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
    );
    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive(foreignEnvelope({ type: 'REQUEST_CONTEXT_SNAPSHOT' }));
    });
    expect(ch.postedMessages).toHaveLength(0);
  });

  it('applies CONTEXT_SNAPSHOT by forwarding it to onSignal', () => {
    const onSignal = vi.fn();
    renderHook(() =>
      usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal })
    );
    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive(
        foreignEnvelope({
          type: 'CONTEXT_SNAPSHOT',
          routeContext: { date: '2026-03-10', crewId: 'c1', depotId: 'd1' },
          selectedCustomerId: 'cust-snap',
          selectedRouteId: null,
          highlightedSegment: 2,
        })
      );
    });
    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CONTEXT_SNAPSHOT', selectedCustomerId: 'cust-snap' })
    );
  });

  it('handles missing BroadcastChannel gracefully', () => {
    delete (global as unknown as Record<string, unknown>).BroadcastChannel;
    expect(() => {
      renderHook(() =>
        usePanelSignals({ enabled: true, isSourceOfTruth: false, onSignal: vi.fn() })
      );
    }).not.toThrow();
  });
});
