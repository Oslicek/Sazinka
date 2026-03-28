/**
 * Tests for "collapse detached panel space" feature.
 *
 * When a panel (map or list) is detached, its container must be removed from
 * the layout so the remaining panels can reclaim the space.
 *
 * Three desktop layouts are covered: dual, grid, wide.
 *
 * TDD: these tests are written BEFORE the implementation. They must all fail
 * on the current code and all pass after the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mutable layout mode — controlled per test
// ---------------------------------------------------------------------------

const { mockLayoutMode } = vi.hoisted(() => ({
  mockLayoutMode: { mode: 'dual' as string, setMode: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mocks (same pattern as PlanningInbox.detach.test.tsx)
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useLayoutMode', () => ({
  useLayoutMode: () => mockLayoutMode,
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: false }),
}));

vi.mock('@/stores/routeCacheStore', () => ({
  useRouteCacheStore: () => ({ getRoute: vi.fn(), setRoute: vi.fn() }),
}));

vi.mock('@/hooks/useAutoSave', () => ({
  useAutoSave: () => ({ isSaving: false, lastSaved: null, saveError: null, retry: vi.fn() }),
}));

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobileUi: false, isTablet: false }),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  usePlannerShortcuts: () => {},
}));

vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="route-map-panel">Map</div>,
}));

vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="inbox-list-panel">List</div>,
}));

vi.mock('@/components/planner', () => ({
  CandidateDetail: () => <div data-testid="candidate-detail">Detail</div>,
  RouteDetailTimeline: () => <div data-testid="route-timeline">Timeline</div>,
  VirtualizedInboxList: () => <div data-testid="virtualized-list">VList</div>,
  RouteMapPanel: () => <div data-testid="planner-map">PlannerMap</div>,
  PlanningTimeline: () => <div data-testid="planning-timeline">PlanningTimeline</div>,
  TimelineViewToggle: () => <div data-testid="timeline-toggle">Toggle</div>,
  MultiCrewTip: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  buildTimelineItems: () => [],
}));

vi.mock('@/components/planner/DraftModeBar', () => ({
  DraftModeBar: () => null,
}));

vi.mock('@/components/common', () => ({
  CollapseButton: () => null,
  // Render left/center/right props so their content is visible in the DOM
  ThreePanelLayout: ({
    left,
    center,
    right,
  }: {
    left?: React.ReactNode;
    center?: React.ReactNode;
    right?: React.ReactNode;
  }) => (
    <div data-testid="three-panel">
      <div data-testid="three-panel-left">{left}</div>
      <div data-testid="three-panel-center">{center}</div>
      <div data-testid="three-panel-right">{right}</div>
    </div>
  ),
  SplitView: ({
    panels,
  }: {
    panels: { id: string; content: React.ReactNode }[];
  }) => (
    <div data-testid="split-view">
      {panels.map((p) => (
        <div key={p.id} data-testid={`split-panel-${p.id}`}>
          {p.content}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/layout', () => ({
  SplitLayout: ({
    left,
    right,
  }: {
    left: React.ReactNode;
    right: React.ReactNode;
  }) => (
    <div data-testid="split-layout">
      {left}
      {right}
    </div>
  ),
  LayoutManager: () => <div data-testid="layout-manager" />,
  DetachButton: ({
    onDetach,
    'data-testid': testId,
  }: {
    onDetach: () => void;
    'data-testid'?: string;
  }) => (
    <button data-testid={testId ?? 'detach-btn'} onClick={onDetach}>
      Detach
    </button>
  ),
  MapPanelShell: ({
    panelName,
    children,
    onDetach,
    canDetach,
  }: {
    panelName: string;
    children: React.ReactNode;
    onDetach?: () => void;
    canDetach?: boolean;
  }) => (
    <div data-testid="map-panel-shell" data-panel={panelName}>
      {canDetach && onDetach && (
        <button data-testid={`detach-${panelName}-btn`} onClick={onDetach}>
          Detach
        </button>
      )}
      {children}
    </div>
  ),
}));

vi.mock('@/services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
  getDepots: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/routeService', () => ({
  getRoute: vi.fn().mockResolvedValue({ route: null, stops: [] }),
  recalculateRoute: vi.fn(),
  saveRoute: vi.fn(),
  deleteRoute: vi.fn(),
  submitRoutePlanJob: vi.fn(),
  subscribeToRouteJobStatus: vi.fn(),
}));

vi.mock('@/services/geometryService', () => ({
  submitGeometryJob: vi.fn().mockResolvedValue({ jobId: 'geo-1' }),
  subscribeToGeometryJobStatus: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [] }),
  listPlannedActions: vi.fn().mockResolvedValue([]),
  updatePlannedAction: vi.fn(),
}));

vi.mock('@/services/inboxAdapter', () => ({
  inboxResponseToCallQueueResponse: vi.fn().mockReturnValue({ items: [] }),
}));

vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/settingsService', () => ({
  getBreakSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/insertionService', () => ({
  getSlotSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/calendarService', () => ({
  listCalendarItems: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/customerService', () => ({
  updateCustomer: vi.fn(),
}));

vi.mock('@/services/revisionService', () => ({
  getRevision: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'cs' } }),
}));

// Mock BroadcastChannel
class MockBroadcastChannel {
  onmessage: null = null;
  postMessage = vi.fn();
  close = vi.fn();
}
(global as unknown as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;

const mockWin = { closed: false, close: vi.fn() };
vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlanningInbox } = await import('../PlanningInbox');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function detachPanel(testId: 'detach-map-btn' | 'detach-list-btn') {
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  fireEvent.click(screen.getByTestId(testId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLayoutMode.mode = 'dual';
  mockWin.closed = false;
  vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Group A: Dual layout — map detached ─────────────────────────────────────

describe('dual layout — map detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'dual'; });

  it('A1: map section header (panel_map) is NOT rendered after map detach', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByText('panel_map')).toBeInTheDocument());

    await detachPanel('detach-map-btn');

    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );
  });

  it('A2: timeline section header (panel_timeline) is still rendered after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.getByText('panel_timeline')).toBeInTheDocument(),
    );
  });

  it('A3: route-map-panel component is NOT in the DOM after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.queryByTestId('route-map-panel')).not.toBeInTheDocument(),
    );
  });

  it('A4: inbox-list-panel is still rendered after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument(),
    );
  });
});

// ── Group B: Grid layout — list detached ────────────────────────────────────

describe('grid layout — list detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'grid'; });

  it('B1: list tile header (panel_list) is NOT rendered after list detach', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByText('panel_list')).toBeInTheDocument());

    await detachPanel('detach-list-btn');

    await waitFor(() =>
      expect(screen.queryByText('panel_list')).not.toBeInTheDocument(),
    );
  });

  it('B2: detail panel is still rendered after list detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-detail')).toBeInTheDocument(),
    );
  });

  it('B3: inbox-list-panel is NOT in the DOM after list detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() =>
      expect(screen.queryByTestId('inbox-list-panel')).not.toBeInTheDocument(),
    );
  });
});

// ── Group C: Grid layout — map detached ─────────────────────────────────────

describe('grid layout — map detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'grid'; });

  it('C1: map tile header (panel_map) is NOT rendered after map detach', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByText('panel_map')).toBeInTheDocument());

    await detachPanel('detach-map-btn');

    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );
  });

  it('C2: timeline tile header (panel_timeline) is still rendered after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.getByText('panel_timeline')).toBeInTheDocument(),
    );
  });

  it('C3: route-map-panel is NOT in the DOM after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.queryByTestId('route-map-panel')).not.toBeInTheDocument(),
    );
  });
});

// ── Group D: Wide layout — list detached ────────────────────────────────────

describe('wide layout — list detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'wide'; });

  it('D1: ThreePanelLayout is NOT used after list detach', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('three-panel')).toBeInTheDocument());

    await detachPanel('detach-list-btn');

    await waitFor(() =>
      expect(screen.queryByTestId('three-panel')).not.toBeInTheDocument(),
    );
  });

  it('D2: detail panel is still rendered after list detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-detail')).toBeInTheDocument(),
    );
  });

  it('D3: map section is still rendered after list detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() =>
      expect(screen.getByTestId('route-map-panel')).toBeInTheDocument(),
    );
  });

  it('D4: inbox-list-panel is NOT in DOM after list detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() =>
      expect(screen.queryByTestId('inbox-list-panel')).not.toBeInTheDocument(),
    );
  });
});

// ── Group E: Wide layout — map detached ─────────────────────────────────────

describe('wide layout — map detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'wide'; });

  it('E1: map section header (panel_map) is NOT rendered after map detach', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByText('panel_map')).toBeInTheDocument());

    await detachPanel('detach-map-btn');

    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );
  });

  it('E2: timeline section header (panel_timeline) is still rendered after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.getByText('panel_timeline')).toBeInTheDocument(),
    );
  });

  it('E3: list panel is still rendered after map detach', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument(),
    );
  });

  it('E4: ThreePanelLayout is still used when only map is detached in wide mode', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.getByTestId('three-panel')).toBeInTheDocument(),
    );
  });
});

// ── Group F: Corner cases — both panels detached ─────────────────────────────

describe('dual layout — both panels detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'dual'; });

  it('F1: map section header gone after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() => expect(screen.getByTestId('detach-list-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-list-btn'));

    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );
  });

  it('F2: timeline section still present after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() => expect(screen.getByTestId('detach-list-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-list-btn'));

    await waitFor(() =>
      expect(screen.getByText('panel_timeline')).toBeInTheDocument(),
    );
  });
});

describe('grid layout — both panels detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'grid'; });

  it('F3: panel_list tile header gone after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() =>
      expect(screen.queryByText('panel_list')).not.toBeInTheDocument(),
    );
  });

  it('F4: panel_map tile header gone after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );
  });

  it('F5: panel_timeline still rendered after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() =>
      expect(screen.getByText('panel_timeline')).toBeInTheDocument(),
    );
  });
});

describe('wide layout — both panels detached', () => {
  beforeEach(() => { mockLayoutMode.mode = 'wide'; });

  it('F6: ThreePanelLayout NOT used after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() =>
      expect(screen.queryByTestId('three-panel')).not.toBeInTheDocument(),
    );
  });

  it('F7: panel_map header NOT present after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );
  });

  it('F8: timeline still rendered after both detached', async () => {
    render(<PlanningInbox />);
    await detachPanel('detach-list-btn');
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() =>
      expect(screen.getByText('panel_timeline')).toBeInTheDocument(),
    );
  });
});

// ── Group G: Functional preservation ────────────────────────────────────────

describe('functional preservation — panels work normally when attached', () => {
  it('G1: dual — map and list both rendered when neither detached', async () => {
    mockLayoutMode.mode = 'dual';
    render(<PlanningInbox />);
    await waitFor(() => {
      expect(screen.getByTestId('route-map-panel')).toBeInTheDocument();
      expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
      expect(screen.getByText('panel_map')).toBeInTheDocument();
      expect(screen.getByText('panel_timeline')).toBeInTheDocument();
    });
  });

  it('G2: grid — all four tile headers present when neither detached', async () => {
    mockLayoutMode.mode = 'grid';
    render(<PlanningInbox />);
    await waitFor(() => {
      expect(screen.getByText('panel_list')).toBeInTheDocument();
      expect(screen.getByText('panel_detail')).toBeInTheDocument();
      expect(screen.getByText('panel_map')).toBeInTheDocument();
      expect(screen.getByText('panel_timeline')).toBeInTheDocument();
    });
  });

  it('G3: wide — ThreePanelLayout used when neither detached', async () => {
    mockLayoutMode.mode = 'wide';
    render(<PlanningInbox />);
    await waitFor(() =>
      expect(screen.getByTestId('three-panel')).toBeInTheDocument(),
    );
  });

  it('G4: dual — reattach restores map section header', async () => {
    mockLayoutMode.mode = 'dual';
    render(<PlanningInbox />);
    await detachPanel('detach-map-btn');
    await waitFor(() =>
      expect(screen.queryByText('panel_map')).not.toBeInTheDocument(),
    );

    // Simulate popup window closing (triggers reattach)
    mockWin.closed = true;
    await waitFor(
      () => expect(screen.getByText('panel_map')).toBeInTheDocument(),
      { timeout: 3000 },
    );
  }, 10000);
});
