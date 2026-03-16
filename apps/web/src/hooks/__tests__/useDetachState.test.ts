import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useDetachState } from '../useDetachState';
import type { PanelSignalEnvelope } from '../../types/panelSignals';
import { PanelStateProvider } from '../../contexts/PanelStateContext';

// ---------------------------------------------------------------------------
// MockBroadcastChannel (shared across tests)
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

  simulateReceive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

// ---------------------------------------------------------------------------
// Wrapper — provides PanelStateContext with a seeded routeContext
// ---------------------------------------------------------------------------

const routeContext = {
  date: '2026-03-10',
  crewId: 'crew-1',
  crewName: 'Crew 1',
  depotId: 'depot-1',
  depotName: 'Brno',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    PanelStateProvider,
    { activePageContext: 'inbox', enableChannel: false, initialRouteContext: routeContext },
    children,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockBroadcastChannel.instances = [];
  (global as unknown as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const mockWin = () => ({ closed: false, close: vi.fn() } as unknown as Window);

describe('useDetachState', () => {
  it('starts with no detached panels', () => {
    const { result } = renderHook(() => useDetachState(), { wrapper });
    expect(result.current.isDetached('map')).toBe(false);
    expect(result.current.isDetached('list')).toBe(false);
  });

  it('detach("map") opens window and marks map as detached', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    expect(result.current.isDetached('map')).toBe(true);
    expect(window.open).toHaveBeenCalled();
  });

  it('detach("map") seeds URL with date/crewId/depotId from current context', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    const calledUrl = openSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('date=2026-03-10');
    expect(calledUrl).toContain('crewId=crew-1');
    expect(calledUrl).toContain('depotId=depot-1');
  });

  it('detach uses activePageContext for ?page= param', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    const calledUrl = openSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('page=inbox');
  });

  it('isDetached("map") returns true after detaching', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    expect(result.current.isDetached('map')).toBe(true);
  });

  it('reattach("map") marks map as embedded again', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    act(() => { result.current.reattach('map'); });
    expect(result.current.isDetached('map')).toBe(false);
  });

  it('canDetach is false when all detachable panels for this page are detached', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    act(() => { result.current.detach('list'); });
    expect(result.current.canDetach).toBe(false);
  });

  it('canDetach is true when at least one panel is still embedded', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    expect(result.current.canDetach).toBe(true);
  });

  it('auto-reattaches when detached window closes (poll window.closed)', () => {
    const win = { closed: false, close: vi.fn() } as unknown as Window & { closed: boolean };
    vi.spyOn(window, 'open').mockReturnValue(win);
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    expect(result.current.isDetached('map')).toBe(true);
    (win as { closed: boolean }).closed = true;
    act(() => { vi.advanceTimersByTime(1100); });
    expect(result.current.isDetached('map')).toBe(false);
  });

  it('sends PANEL_DETACHED signal with page field on detach', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    const ch = MockBroadcastChannel.instances[0];
    const env = ch.postedMessages[0] as PanelSignalEnvelope;
    expect(env.signal.type).toBe('PANEL_DETACHED');
    if (env.signal.type === 'PANEL_DETACHED') {
      expect(env.signal.panel).toBe('map');
      expect(env.signal.page).toBe('inbox');
    }
  });

  it('sends PANEL_REATTACHED signal with page field on reattach', () => {
    vi.spyOn(window, 'open').mockReturnValue(mockWin());
    const { result } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    act(() => { result.current.reattach('map'); });
    const ch = MockBroadcastChannel.instances[0];
    const messages = ch.postedMessages as PanelSignalEnvelope[];
    const reattachMsg = messages.find(m => m.signal.type === 'PANEL_REATTACHED');
    expect(reattachMsg).toBeDefined();
    if (reattachMsg?.signal.type === 'PANEL_REATTACHED') {
      expect(reattachMsg.signal.panel).toBe('map');
      expect(reattachMsg.signal.page).toBe('inbox');
    }
  });

  it('receives PANEL_DETACHED from other window and updates state', () => {
    const { result } = renderHook(() => useDetachState(), { wrapper });
    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive({
        senderId: 'other-window',
        signal: { type: 'PANEL_DETACHED', panel: 'list', page: 'inbox' },
      } as PanelSignalEnvelope);
    });
    expect(result.current.isDetached('list')).toBe(true);
  });

  it('ignores PANEL_DETACHED signals from a different page', () => {
    const { result } = renderHook(() => useDetachState(), { wrapper });
    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive({
        senderId: 'other-window',
        signal: { type: 'PANEL_DETACHED', panel: 'map', page: 'plan' },
      } as PanelSignalEnvelope);
    });
    expect(result.current.isDetached('map')).toBe(false);
  });

  it('closes all detached windows on unmount (page navigation cleanup)', () => {
    const win = mockWin();
    vi.spyOn(window, 'open').mockReturnValue(win);
    const { result, unmount } = renderHook(() => useDetachState(), { wrapper });
    act(() => { result.current.detach('map'); });
    unmount();
    expect((win as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
  });
});
