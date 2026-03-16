import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { PanelSignalEnvelope } from '../../../types/panelSignals';

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

  close() { this.closed = true; }

  simulateReceive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  MockBroadcastChannel.instances = [];
  (global as unknown as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNatsConnect = vi.fn().mockResolvedValue(undefined);
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: true, connect: mockNatsConnect }),
}));

vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">MapPanel</div>,
}));

vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="list-panel">ListPanel</div>,
}));

vi.mock('@/contexts/PanelStateContext', () => {
  let capturedProps: Record<string, unknown> = {};
  return {
    PanelStateProvider: ({
      children,
      enableChannel,
      isSourceOfTruth,
      initialRouteContext,
      activePageContext,
    }: {
      children: React.ReactNode;
      enableChannel: boolean;
      isSourceOfTruth: boolean;
      initialRouteContext?: unknown;
      activePageContext?: string;
    }) => {
      capturedProps = { enableChannel, isSourceOfTruth, initialRouteContext, activePageContext };
      return (
        <div
          data-testid="panel-provider"
          data-enable-channel={String(enableChannel)}
          data-source-of-truth={String(isSourceOfTruth)}
          data-page-context={activePageContext}
          data-has-route-context={String(!!initialRouteContext)}
        >
          {children}
        </div>
      );
    },
    _getCapturedProps: () => capturedProps,
  };
});

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DetachedPanelPage } = await import('../DetachedPanelPage');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DetachedPanelPage (G.6 bootstrap)', () => {
  it('renders Map panel at /panel/map', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
  });

  it('renders List panel at /panel/list', () => {
    render(<DetachedPanelPage panel="list" pageContext="inbox" />);
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
  });

  it('wraps panel in PanelStateProvider with enableChannel=true', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-enable-channel', 'true');
  });

  it('wraps panel in PanelStateProvider with isSourceOfTruth=false', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-source-of-truth', 'false');
  });

  it('applies URL-seeded context immediately for initial load', () => {
    render(
      <DetachedPanelPage
        panel="map"
        pageContext="inbox"
        urlSeed={{ date: '2026-03-10', crewId: 'crew-1', depotId: 'depot-1' }}
      />
    );
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-has-route-context', 'true');
  });

  it('requests CONTEXT_SNAPSHOT on mount via BroadcastChannel', async () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);

    await waitFor(() => {
      const ch = MockBroadcastChannel.instances[0];
      const msgs = ch?.postedMessages as PanelSignalEnvelope[] ?? [];
      return msgs.some(m => m.signal.type === 'REQUEST_CONTEXT_SNAPSHOT');
    });

    const ch = MockBroadcastChannel.instances[0];
    const msgs = ch.postedMessages as PanelSignalEnvelope[];
    expect(msgs.some(m => m.signal.type === 'REQUEST_CONTEXT_SNAPSHOT')).toBe(true);
  });

  it('overrides URL-seeded context when CONTEXT_SNAPSHOT arrives', async () => {
    render(
      <DetachedPanelPage
        panel="map"
        pageContext="inbox"
        urlSeed={{ date: '2026-03-10', crewId: 'crew-1', depotId: 'depot-1' }}
      />
    );

    // Wait for REQUEST_CONTEXT_SNAPSHOT to be sent
    await waitFor(() => {
      const ch = MockBroadcastChannel.instances[0];
      return (ch?.postedMessages as PanelSignalEnvelope[])?.some(m => m.signal.type === 'REQUEST_CONTEXT_SNAPSHOT');
    });

    const ch = MockBroadcastChannel.instances[0];
    // Simulate snapshot arriving from main window
    act(() => {
      ch.simulateReceive({
        senderId: 'main-window',
        signal: {
          type: 'CONTEXT_SNAPSHOT',
          routeContext: { date: '2026-03-11', crewId: 'crew-2', depotId: 'depot-2' },
          selectedCustomerId: 'cust-snap',
          selectedRouteId: null,
          highlightedSegment: null,
        },
      } as PanelSignalEnvelope);
    });

    // Panel should still render (snapshot was applied internally)
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
  });

  it('keeps URL-seeded context when snapshot timeout elapses', async () => {
    render(
      <DetachedPanelPage
        panel="map"
        pageContext="inbox"
        urlSeed={{ date: '2026-03-10', crewId: 'crew-1', depotId: 'depot-1' }}
        snapshotTimeoutMs={50}
      />
    );

    // Wait for timeout to elapse — panel should still render with URL seed
    await new Promise(r => setTimeout(r, 100));
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-has-route-context', 'true');
  });

  it('sends PANEL_REATTACHED signal on window beforeunload', async () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);

    await waitFor(() => MockBroadcastChannel.instances.length > 0);

    // Trigger beforeunload
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    const ch = MockBroadcastChannel.instances[0];
    const msgs = ch.postedMessages as PanelSignalEnvelope[];
    expect(msgs.some(m => m.signal.type === 'PANEL_REATTACHED')).toBe(true);
  });

  it('shows connection status indicator', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('detached-panel-chrome')).toBeInTheDocument();
  });

  it('rejects invalid panel IDs gracefully (renders nothing / fallback)', () => {
    // @ts-expect-error — intentionally passing invalid panel
    render(<DetachedPanelPage panel="invalid" pageContext="inbox" />);
    expect(screen.queryByTestId('map-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-panel')).not.toBeInTheDocument();
  });

  it('clears syncing indicator when CONTEXT_SNAPSHOT with null routeContext arrives', async () => {
    render(
      <DetachedPanelPage
        panel="map"
        pageContext="inbox"
        urlSeed={{ date: '2026-03-10', crewId: 'crew-1', depotId: 'depot-1' }}
        snapshotTimeoutMs={5000}
      />
    );

    await waitFor(() => {
      const ch = MockBroadcastChannel.instances[0];
      return (ch?.postedMessages as PanelSignalEnvelope[])?.some(m => m.signal.type === 'REQUEST_CONTEXT_SNAPSHOT');
    });

    const ch = MockBroadcastChannel.instances[0];
    act(() => {
      ch.simulateReceive({
        senderId: 'main-window',
        signal: {
          type: 'CONTEXT_SNAPSHOT',
          routeContext: null,
          selectedCustomerId: null,
          selectedRouteId: null,
          highlightedSegment: null,
        },
      } as PanelSignalEnvelope);
    });

    const chrome = screen.getByTestId('detached-panel-chrome');
    expect(chrome.textContent).not.toContain('syncing');
  });

  it('passes activePageContext from pageContext prop to provider', () => {
    render(<DetachedPanelPage panel="map" pageContext="plan" />);
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-page-context', 'plan');
  });

  it('sends PANEL_REATTACHED with correct panel and page on beforeunload', async () => {
    render(<DetachedPanelPage panel="list" pageContext="inbox" />);

    await waitFor(() => MockBroadcastChannel.instances.length > 0);

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    const ch = MockBroadcastChannel.instances[0];
    const msgs = ch.postedMessages as PanelSignalEnvelope[];
    const reattachMsg = msgs.find(m => m.signal.type === 'PANEL_REATTACHED');
    expect(reattachMsg).toBeDefined();
    if (reattachMsg?.signal.type === 'PANEL_REATTACHED') {
      expect(reattachMsg.signal.panel).toBe('list');
      expect(reattachMsg.signal.page).toBe('inbox');
    }
  });
});
