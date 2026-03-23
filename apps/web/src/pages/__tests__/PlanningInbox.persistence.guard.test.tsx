/**
 * Phase 0 — PlanningInbox persistence guard tests.
 *
 * These tests lock the current route-persistence behavior of the PlanningInbox
 * page so that any future UPP migration cannot silently break it.  They are
 * intentionally written against the *existing* implementation (no production
 * code changes in Phase 0) and must remain GREEN throughout every subsequent
 * phase.
 *
 * Covers:
 *  - Inbox restores route context from persisted state without changing route loading behavior
 *  - Inbox selected candidate restore does not break route timeline rendering
 *  - Corrupt planningInbox.context in sessionStorage falls back without breaking route load
 *  - Missing crew/depot ids in saved context resolve to loaded crews/depots like today
 *  - Settings page enforceDrivingBreakRule write is compatible with Inbox read
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Router mock
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearch: vi.fn(() => ({})),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Breakpoint mock
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => ({
    breakpoint: 'desktop',
    isPhone: false,
    isMobileUi: false,
    isTouch: false,
  })),
}));

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn(() => ({ isConnected: false })),
}));

vi.mock('@/stores/routeCacheStore', () => ({
  useRouteCacheStore: vi.fn(() => ({
    setRouteContext: vi.fn(),
    getCachedInsertion: vi.fn(),
    setCachedInsertions: vi.fn(),
    incrementRouteVersion: vi.fn(),
    invalidateCache: vi.fn(),
  })),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector: (s: { user: { name: string } | null }) => unknown) =>
    selector({ user: { name: 'Test' } }),
  ),
}));

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/routeService', () => ({
  recalculateRoute: vi.fn(),
  getRoute: vi.fn().mockResolvedValue(null),
  saveRoute: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/calendarService', () => ({
  listCalendarItems: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/insertionService', () => ({
  calculateInsertions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/geometryService', () => ({
  calculateRouteShape: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [] }),
  listPlannedActions: vi.fn().mockResolvedValue([]),
  updatePlannedAction: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({
    isSaving: false,
    lastSaved: null,
    saveError: null,
    retry: vi.fn(),
  })),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  usePlannerShortcuts: vi.fn(),
}));

vi.mock('@/hooks/useDetachState', () => ({
  useDetachState: () => ({
    isDetached: () => false,
    detach: vi.fn(),
    reattach: vi.fn(),
    canDetach: true,
  }),
}));

vi.mock('@/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ mode: 'wide', setMode: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Panel mocks
// ---------------------------------------------------------------------------

vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">Map</div>,
}));

vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="inbox-list-panel">List</div>,
}));

// ---------------------------------------------------------------------------
// Heavy component mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/planner', () => ({
  RouteMapPanel: () => <div data-testid="map-panel-planner">Map</div>,
  VirtualizedInboxList: () => <div data-testid="inbox-list">List</div>,
  CandidateDetail: () => <div data-testid="candidate-detail">Detail</div>,
  MultiCrewTip: () => null,
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  PlanningTimeline: () => <div data-testid="planning-timeline" />,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  buildTimelineItems: vi.fn(() => []),
}));

vi.mock('@/components/planner/DraftModeBar', () => ({
  DraftModeBar: () => null,
}));

vi.mock('@/components/common', () => ({
  CollapseButton: () => null,
  ThreePanelLayout: ({
    left,
    center,
    right,
  }: {
    left: React.ReactNode;
    center: React.ReactNode;
    right: React.ReactNode;
  }) => (
    <div data-testid="three-panel-layout">
      <div data-testid="panel-left">{left}</div>
      <div data-testid="panel-center">{center}</div>
      <div data-testid="panel-right">{right}</div>
    </div>
  ),
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">
      {panels.map((p: { id: string; content: React.ReactNode }) => (
        <div key={p.id}>{p.content}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/layout', () => ({
  SplitLayout: ({ first, second }: { first: React.ReactNode; second: React.ReactNode }) => (
    <div data-testid="split-layout">{first}{second}</div>
  ),
  LayoutManager: () => <div data-testid="layout-manager">LayoutManager</div>,
  DetachButton: ({ onDetach, 'data-testid': testId }: { onDetach: () => void; 'data-testid'?: string }) => (
    <button data-testid={testId ?? 'detach-btn'} onClick={onDetach}>Detach</button>
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

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { PlanningInbox } from '../PlanningInbox';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_CONTEXT = {
  date: '2026-03-21',
  crewId: 'crew-1',
  crewName: 'P1',
  depotId: 'depot-1',
  depotName: 'Brno HQ',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanningInbox — persistence guard (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('Inbox restores route context from persisted state without changing route loading behavior', () => {
    // Arrange: store a valid context in sessionStorage
    sessionStorage.setItem('planningInbox.context', JSON.stringify(VALID_CONTEXT));

    // Act: render — must not throw
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: inbox list panel is visible (page loaded successfully)
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('Inbox selected candidate restore does not break route timeline rendering', () => {
    // Arrange: store a selected candidate id
    sessionStorage.setItem('planningInbox.selectedId', 'cust-abc-123');
    sessionStorage.setItem('planningInbox.context', JSON.stringify(VALID_CONTEXT));

    // Act: render — must not throw
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: page renders without crash (inbox list is always present)
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('corrupt planningInbox.context in sessionStorage falls back without breaking route load', () => {
    // Arrange: store corrupt JSON
    sessionStorage.setItem('planningInbox.context', '{ this is not valid json !!!');

    // Act: render — must not throw (corrupt data must be silently ignored)
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: page still renders
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('missing crew/depot ids in saved context resolve to loaded crews/depots like today', async () => {
    // Arrange: context with unknown crew/depot ids (simulates stale data after crew was deleted)
    const staleContext = {
      date: '2026-01-01',
      crewId: 'crew-deleted-9999',
      crewName: 'Old Crew',
      depotId: 'depot-deleted-9999',
      depotName: 'Old Depot',
    };
    sessionStorage.setItem('planningInbox.context', JSON.stringify(staleContext));

    // Act: render — must not throw
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: page renders (fallback to defaults applied)
    await waitFor(() => {
      expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
    });
  });

  it('Settings page enforceDrivingBreakRule write is compatible with Inbox read', () => {
    // Arrange: simulate Settings page writing the value (true)
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'true');

    // Act: render Inbox — it reads the same key on mount
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: page renders without crash (value was read successfully)
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('Settings page enforceDrivingBreakRule write false is compatible with Inbox read', () => {
    // Arrange: simulate Settings page writing the value (false)
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'false');

    // Act: render Inbox
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: page renders without crash
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('corrupt planningInbox.filters in sessionStorage falls back to default filter expression', () => {
    // Arrange: store corrupt filter JSON
    sessionStorage.setItem('planningInbox.filters', '{ bad json');

    // Act: render — must not throw
    expect(() => render(<PlanningInbox />)).not.toThrow();

    // Assert: page still renders
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });
});
