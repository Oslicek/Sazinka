import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelChannel } from '../usePanelChannel';
import type { PanelChannelMessage } from '../usePanelChannel';
import type { PanelState } from '../../types/panelState';

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

  simulateReceive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const baseState: PanelState = {
  selectedCustomerId: null,
  selectedRouteId: null,
  routeContext: null,
  routeStops: [],
  highlightedSegment: null,
  insertionPreview: null,
  activePageContext: 'inbox',
  routeGeometry: [],
  returnToDepotLeg: null,
  depotDeparture: null,
  routeWarnings: [],
  breakWarnings: [],
  metrics: null,
  routeBufferPercent: 0,
  routeBufferFixedMinutes: 0,
};

beforeEach(() => {
  MockBroadcastChannel.instances = [];
  (global as unknown as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
});

describe('usePanelChannel', () => {
  it('opens a BroadcastChannel when enableChannel=true', () => {
    const dispatch = vi.fn();
    renderHook(() => usePanelChannel(true, baseState, dispatch));

    expect(MockBroadcastChannel.instances).toHaveLength(1);
    expect(MockBroadcastChannel.instances[0].name).toBe('sazinka-inbox');
  });

  it('does not open BroadcastChannel when enableChannel=false', () => {
    const dispatch = vi.fn();
    renderHook(() => usePanelChannel(false, baseState, dispatch));

    expect(MockBroadcastChannel.instances).toHaveLength(0);
  });

  it('broadcasts selectedCustomerId change to other windows', () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ state }: { state: PanelState }) => usePanelChannel(true, state, dispatch),
      { initialProps: { state: baseState } }
    );

    rerender({ state: { ...baseState, selectedCustomerId: 'cust-1' } });

    const channel = MockBroadcastChannel.instances[0];
    expect(channel.postedMessages).toHaveLength(1);
    const msg = channel.postedMessages[0] as PanelChannelMessage;
    expect(msg.type).toBe('STATE_UPDATE');
    expect(msg.payload).toEqual({ selectedCustomerId: 'cust-1' });
  });

  it('does not echo own messages back', () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ state }: { state: PanelState }) => usePanelChannel(true, state, dispatch),
      { initialProps: { state: baseState } }
    );

    rerender({ state: { ...baseState, selectedCustomerId: 'cust-1' } });

    const channel = MockBroadcastChannel.instances[0];
    const sentMsg = channel.postedMessages[0] as PanelChannelMessage;

    act(() => {
      channel.simulateReceive(sentMsg);
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('receives selectedCustomerId from another window and updates state', () => {
    const dispatch = vi.fn();
    renderHook(() => usePanelChannel(true, baseState, dispatch));

    const channel = MockBroadcastChannel.instances[0];
    act(() => {
      channel.simulateReceive({
        type: 'STATE_UPDATE',
        senderId: 'other-window-id',
        payload: { selectedCustomerId: 'cust-from-other-window' },
      } as PanelChannelMessage);
    });

    expect(dispatch).toHaveBeenCalledWith({ selectedCustomerId: 'cust-from-other-window' });
  });

  it('broadcasts routeContext change to other windows', () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ state }: { state: PanelState }) => usePanelChannel(true, state, dispatch),
      { initialProps: { state: baseState } }
    );

    const newContext = {
      date: '2026-03-10',
      crewId: 'crew-1',
      crewName: 'Crew 1',
      depotId: 'depot-1',
      depotName: 'Brno',
    };
    rerender({ state: { ...baseState, routeContext: newContext as PanelState['routeContext'] } });

    const channel = MockBroadcastChannel.instances[0];
    expect(channel.postedMessages).toHaveLength(1);
    const msg = channel.postedMessages[0] as PanelChannelMessage;
    expect(msg.type).toBe('STATE_UPDATE');
    expect(msg.payload).toHaveProperty('routeContext');
  });

  it('broadcasts routeStops change to other windows', () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ state }: { state: PanelState }) => usePanelChannel(true, state, dispatch),
      { initialProps: { state: baseState } }
    );

    const stops = [{ id: 'stop-1' }] as PanelState['routeStops'];
    rerender({ state: { ...baseState, routeStops: stops } });

    const channel = MockBroadcastChannel.instances[0];
    expect(channel.postedMessages).toHaveLength(1);
    const msg = channel.postedMessages[0] as PanelChannelMessage;
    expect(msg.payload).toHaveProperty('routeStops');
  });

  it('closes the channel on unmount', () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() => usePanelChannel(true, baseState, dispatch));

    const channel = MockBroadcastChannel.instances[0];
    unmount();

    expect(channel.closed).toBe(true);
  });

  it('handles missing BroadcastChannel gracefully (older browsers)', () => {
    delete (global as unknown as Record<string, unknown>).BroadcastChannel;
    const dispatch = vi.fn();

    expect(() => {
      renderHook(() => usePanelChannel(true, baseState, dispatch));
    }).not.toThrow();

    expect(MockBroadcastChannel.instances).toHaveLength(0);
  });
});
