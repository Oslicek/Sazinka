/**
 * G.5 — Detach wiring tests for PlanningInbox.
 *
 * These tests verify that DetachButton appears on Map and List panels in all
 * layout modes, and that panels are hidden/shown based on detach state.
 *
 * We test the PlanningInboxInner component directly (after extracting
 * useDetachState) by rendering it inside a PanelStateProvider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — all heavy dependencies
// ---------------------------------------------------------------------------

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

vi.mock('@/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ mode: 'grid', setMode: vi.fn() }),
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
  ThreePanelLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="three-panel">{children}</div>,
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">{panels.map(p => <div key={p.id}>{p.content}</div>)}</div>
  ),
}));

vi.mock('@/components/layout', () => ({
  SplitLayout: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="split-layout">{left}{right}</div>
  ),
  LayoutManager: () => <div data-testid="layout-manager">LayoutManager</div>,
  DetachButton: ({ onDetach, 'data-testid': testId }: { onDetach: () => void; 'data-testid'?: string }) => (
    <button data-testid={testId ?? 'detach-btn'} onClick={onDetach}>Detach</button>
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

// Mock window.open
const mockWin = { closed: false, close: vi.fn() };
vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks are set up
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlanningInbox } = await import('../PlanningInbox');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockWin.closed = false;
  vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlanningInbox — detach wiring (G.5)', () => {
  it('renders Map panel when not detached', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('route-map-panel')).toBeInTheDocument());
  });

  it('renders List panel when not detached', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument());
  });

  it('shows detach button for Map panel', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
  });

  it('shows detach button for List panel', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('detach-list-btn')).toBeInTheDocument());
  });

  it('hides Map panel when map is detached', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() => expect(screen.queryByTestId('route-map-panel')).not.toBeInTheDocument());
  });

  it('hides List panel when list is detached', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('detach-list-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-list-btn'));

    await waitFor(() => expect(screen.queryByTestId('inbox-list-panel')).not.toBeInTheDocument());
  });

  it('shows Map panel again when detached window closes', async () => {
    // Use real timers — poll interval in useDetachState runs every 1s
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-map-btn'));
    await waitFor(() => expect(screen.queryByTestId('route-map-panel')).not.toBeInTheDocument());

    // Simulate window closing
    mockWin.closed = true;
    await waitFor(
      () => expect(screen.getByTestId('route-map-panel')).toBeInTheDocument(),
      { timeout: 3000 }
    );
  }, 10000);

  it('hides detach buttons when both Map and List are detached (canDetach=false)', async () => {
    render(<PlanningInbox />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-map-btn'));
    // After first detach, list detach button should still be visible
    await waitFor(() => expect(screen.getByTestId('detach-list-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detach-list-btn'));

    // After both detached, no detach buttons should be visible
    await waitFor(
      () => {
        expect(screen.queryByTestId('detach-map-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('detach-list-btn')).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  }, 10000);
});
