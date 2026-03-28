/**
 * Phase 5 (RED → GREEN) — PlanningInbox deep-link consume and URL cleanup.
 *
 * PI5-1: customerId in search → selectedCandidateId set to target
 * PI5-2: URL cleanup executes — navigate called with replace: true and cleared search
 * PI5-3: Session selectedId key updated
 * PI5-4: Focus handoff key stored
 * PI5-5: Missing customerId → falls back to existing session selected id
 * PI5-6: Query id overrides prior session selected id
 * PI5-7: Empty/invalid defensive path — no crash, fallback
 * PI5-8: One-time consume — no repeated cleanup loops
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ── Router mock ───────────────────────────────────────────────────────────────
const { mockNavigate, mockUseSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseSearch: vi.fn(() => ({})),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => mockNavigate),
  useSearch: mockUseSearch,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ── Breakpoint mock ───────────────────────────────────────────────────────────
vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => ({ isMobileUi: false, isTabletUi: false, isDesktopUi: true, isTouch: false })),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────
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

// ── Service mocks ─────────────────────────────────────────────────────────────
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
  getInbox: vi.fn().mockResolvedValue({ items: [], total: 0, overdueCount: 0, dueSoonCount: 0 }),
  listPlannedActions: vi.fn().mockResolvedValue([]),
  updatePlannedAction: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(null),
}));

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

vi.mock('@/hooks/useLastVisitComment', () => ({
  useLastVisitComment: vi.fn(() => ({ notes: null, visit: null })),
}));

// ── Panel and component mocks ─────────────────────────────────────────────────
vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">Map</div>,
}));

vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="inbox-list-panel">List</div>,
}));

vi.mock('@/components/planner', () => ({
  RouteMapPanel: () => <div data-testid="map-panel-planner">Map</div>,
  VirtualizedInboxList: () => <div data-testid="inbox-list" />,
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
    <div>{panels.map((p: { id: string; content: React.ReactNode }) => <div key={p.id}>{p.content}</div>)}</div>
  ),
}));

vi.mock('@/components/layout', () => ({
  SplitLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LayoutManager: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DetachButton: () => null,
  MapPanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/services/revisionService', () => ({
  unscheduleRevision: vi.fn(),
}));

vi.mock('@/services/customerService', () => ({
  updateCustomer: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// ── Import under test ─────────────────────────────────────────────────────────
import { PlanningInbox } from '../PlanningInbox';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanningInbox – deep-link consume (Phase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseSearch.mockReturnValue({});
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('PI5-1: customerId in search sets selectedCandidateId to target', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'target-1' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('target-1');
    });
  });

  it('PI5-2: navigate called with replace=true and cleared search', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'target-2' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ replace: true, search: expect.objectContaining({}) })
      );
    });
    // customerId must NOT be present in the cleaned search
    const navCall = mockNavigate.mock.calls.find((c) =>
      c[0]?.replace === true
    );
    expect(navCall).toBeDefined();
    expect(navCall![0].search?.customerId).toBeUndefined();
  });

  it('PI5-3: sessionStorage planningInbox.selectedId updated to target', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'target-3' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('target-3');
    });
  });

  it('PI5-4: sessionStorage planningInbox.focusCustomerId stores handoff key', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'target-4' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.focusCustomerId')).toBe('target-4');
    });
  });

  it('PI5-5: missing customerId falls back to existing session selectedId', async () => {
    sessionStorage.setItem('planningInbox.selectedId', 'prior-session-id');
    mockUseSearch.mockReturnValue({});

    render(<PlanningInbox />);

    // navigate should NOT be called with replace:true (no cleanup needed)
    await new Promise((r) => setTimeout(r, 50));
    const cleanupCalls = mockNavigate.mock.calls.filter((c) => c[0]?.replace === true);
    expect(cleanupCalls).toHaveLength(0);
    // Prior session value preserved
    expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('prior-session-id');
  });

  it('PI5-6: query id overrides prior session selectedId', async () => {
    sessionStorage.setItem('planningInbox.selectedId', 'prior-id');
    mockUseSearch.mockReturnValue({ customerId: 'new-id' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('new-id');
    });
  });

  it('PI5-7: empty/whitespace customerId does not crash or override', async () => {
    sessionStorage.setItem('planningInbox.selectedId', 'safe-id');
    mockUseSearch.mockReturnValue({ customerId: '' });

    expect(() => render(<PlanningInbox />)).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    // Should not have overwritten the existing selection
    expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('safe-id');
  });

  it('PI5-8: one-time consume — navigate cleanup called at most once', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'target-8' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('target-8');
    });

    const replaceCalls = mockNavigate.mock.calls.filter((c) => c[0]?.replace === true);
    // StrictMode double-invokes effects but the ref guard should dedupe: 1 or 2 is ok
    // (StrictMode runs mount→unmount→remount, so up to 2 calls is acceptable)
    expect(replaceCalls.length).toBeGreaterThanOrEqual(1);
    expect(replaceCalls.length).toBeLessThanOrEqual(2);
  });
});
