/**
 * BUG-14 — Selected pinned customer not shown as orange circle on map.
 *
 * Root cause: PlanningInbox.loadCandidates calls getInbox() without
 * focusCustomerId, so the parent `candidates` array doesn't include
 * the deep-linked customer. buildSelectedCandidatesForMap can't find
 * it → no orange circle.
 *
 * B14-1: loadCandidates passes focusCustomerId from sessionStorage to getInbox
 * B14-2: loadCandidates does not pass focusCustomerId when not in sessionStorage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const { mockNavigate, mockUseSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseSearch: vi.fn(() => ({})),
}));

const { mockGetInbox } = vi.hoisted(() => ({
  mockGetInbox: vi.fn().mockResolvedValue({ items: [], total: 0, overdueCount: 0, dueSoonCount: 0 }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => mockNavigate),
  useSearch: mockUseSearch,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => ({ isMobileUi: false, isTabletUi: false, isDesktopUi: true, isTouch: false })),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn(() => ({ isConnected: true })),
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
  getInbox: mockGetInbox,
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

import { PlanningInbox } from '../PlanningInbox';

describe('BUG-14: PlanningInbox loadCandidates passes focusCustomerId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseSearch.mockReturnValue({});
    mockGetInbox.mockResolvedValue({ items: [], total: 0, overdueCount: 0, dueSoonCount: 0 });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('B14-1: getInbox called with focusCustomerId when present in sessionStorage', async () => {
    sessionStorage.setItem('planningInbox.focusCustomerId', 'focused-abc');

    render(<PlanningInbox />);

    await waitFor(() => {
      const calls = mockGetInbox.mock.calls;
      const callWithFocus = calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.focusCustomerId === 'focused-abc',
      );
      expect(callWithFocus).toBeDefined();
    });
  });

  it('B14-2: getInbox called without focusCustomerId when not in sessionStorage', async () => {
    render(<PlanningInbox />);

    await waitFor(() => {
      expect(mockGetInbox).toHaveBeenCalled();
    });

    const calls = mockGetInbox.mock.calls;
    calls.forEach((c: unknown[]) => {
      const arg = c[0] as Record<string, unknown>;
      expect(arg.focusCustomerId).toBeUndefined();
    });
  });
});
