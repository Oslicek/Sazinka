/**
 * Phase 4 — PlanningInbox mobile tests
 *
 * Tests the mobile tab-switching layout. The desktop ThreePanelLayout
 * is not tested here (covered by baseline snapshot).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockMatchMedia, setViewport, VIEWPORTS } from '../test/utils/responsive';

// ── Router mock ───────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => mockNavigate),
  useSearch: vi.fn(() => ({})),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ── Breakpoint mock ───────────────────────────────────────────────────────────
vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(),
}));
import { useBreakpoint } from '@/hooks/useBreakpoint';
const mockUseBreakpoint = vi.mocked(useBreakpoint);

// ── Store mocks ───────────────────────────────────────────────────────────────
vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn(() => ({ isConnected: true })),
}));

vi.mock('../stores/routeCacheStore', () => ({
  useRouteCacheStore: vi.fn(() => ({
    setRouteContext: vi.fn(),
    getCachedInsertion: vi.fn(),
    setCachedInsertions: vi.fn(),
    incrementRouteVersion: vi.fn(),
    invalidateCache: vi.fn(),
  })),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector: (s: { user: { name: string } | null }) => unknown) =>
    selector({ user: { name: 'Test' } }),
  ),
}));

// ── Service mocks (return empty data) ─────────────────────────────────────────
vi.mock('../services/revisionService', () => ({
  getCallQueue: vi.fn().mockResolvedValue([]),
  snoozeRevision: vi.fn(),
  scheduleRevision: vi.fn(),
}));
vi.mock('../services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/routeService', () => ({
  recalculateRoute: vi.fn(),
  getRoute: vi.fn().mockResolvedValue(null),
  saveRoute: vi.fn(),
}));
vi.mock('../services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/calendarService', () => ({
  listCalendarItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/insertionService', () => ({
  calculateInsertions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/geometryService', () => ({
  calculateRouteShape: vi.fn().mockResolvedValue(null),
}));
vi.mock('../hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({
    hasChanges: false,
    isSaving: false,
    lastSaved: null,
    saveError: null,
    retrySave: vi.fn(),
    markDirty: vi.fn(),
    markClean: vi.fn(),
  })),
}));
vi.mock('../hooks/useKeyboardShortcuts', () => ({
  usePlannerShortcuts: vi.fn(),
}));

// ── Heavy child component mocks ───────────────────────────────────────────────
vi.mock('../components/planner', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">Map</div>,
  VirtualizedInboxList: () => <div data-testid="inbox-list">List</div>,
  CandidateDetail: () => <div data-testid="candidate-detail">Detail</div>,
  ThreePanelLayout: ({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="three-panel-layout">
      <div data-testid="panel-left">{left}</div>
      <div data-testid="panel-center">{center}</div>
      <div data-testid="panel-right">{right}</div>
    </div>
  ),
  MultiCrewTip: () => null,
  RouteDetailTimeline: () => null,
  PlanningTimeline: () => null,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  buildTimelineItems: vi.fn(() => []),
}));
vi.mock('../components/planner/DraftModeBar', () => ({
  DraftModeBar: () => null,
}));
vi.mock('../components/planner/InboxFilterBar', () => ({
  InboxFilterBar: () => null,
}));
vi.mock('../services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [], total: 0, overdueCount: 0, dueSoonCount: 0 }),
  listPlannedActions: vi.fn().mockResolvedValue({ items: [] }),
  updatePlannedAction: vi.fn(),
}));
vi.mock('../services/inboxAdapter', () => ({
  inboxResponseToCallQueueResponse: vi.fn().mockReturnValue({ items: [] }),
}));
vi.mock('../services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../components/common', () => ({
  CollapseButton: () => null,
  ThreePanelLayout: ({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="three-panel-layout">
      <div>{left}</div><div>{center}</div><div>{right}</div>
    </div>
  ),
}));

import { PlanningInbox } from './PlanningInbox';

describe('PlanningInbox mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.phone.width);
      setViewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
      mockUseBreakpoint.mockReturnValue({
        breakpoint: 'phone',
        isPhone: true,
        isMobileUi: true,
        isTouch: true,
      });
    });

    it('renders MobileTabBar with List/Map/Detail tabs', () => {
      render(<PlanningInbox />);
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'tab_list' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'tab_map' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'tab_detail' })).toBeInTheDocument();
    });

    it('shows inbox list when List tab is active (default)', () => {
      render(<PlanningInbox />);
      expect(screen.getByTestId('inbox-list')).toBeInTheDocument();
      expect(screen.queryByTestId('map-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('candidate-detail')).not.toBeInTheDocument();
    });

    it('shows map panel when Map tab is clicked', async () => {
      render(<PlanningInbox />);
      await userEvent.click(screen.getByRole('tab', { name: 'tab_map' }));
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ search: expect.any(Function) }),
      );
    });

    it('does NOT render ThreePanelLayout on phone', () => {
      render(<PlanningInbox />);
      expect(screen.queryByTestId('three-panel-layout')).not.toBeInTheDocument();
    });
  });

  describe('tablet layout', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.tablet.width);
      setViewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
      mockUseBreakpoint.mockReturnValue({
        breakpoint: 'tablet',
        isPhone: false,
        isMobileUi: true,
        isTouch: true,
      });
    });

    it('also renders MobileTabBar on tablet (isMobileUi=true)', () => {
      render(<PlanningInbox />);
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });
  });

  describe('desktop layout', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.desktop.width);
      setViewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
      mockUseBreakpoint.mockReturnValue({
        breakpoint: 'desktop',
        isPhone: false,
        isMobileUi: false,
        isTouch: false,
      });
    });

    it('renders ThreePanelLayout on desktop (unchanged)', () => {
      render(<PlanningInbox />);
      expect(screen.getByTestId('three-panel-layout')).toBeInTheDocument();
    });

    it('does NOT render MobileTabBar on desktop', () => {
      render(<PlanningInbox />);
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });
  });
});
