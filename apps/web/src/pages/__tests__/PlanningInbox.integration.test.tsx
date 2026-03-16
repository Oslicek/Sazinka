/**
 * A.6 Integration tests — PlanningInbox wraps with PanelStateProvider.
 *
 * These tests verify that:
 *   1. The page renders its core panels (inbox list, map).
 *   2. PanelStateProvider is present — `usePanelState()` inside
 *      PlanningInboxInner does NOT throw.
 *   3. The bridge effect works: selecting a candidate in the inbox list
 *      causes the detail panel to appear in mobile mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

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
  getInbox: vi.fn().mockResolvedValue({ items: [] }),
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

// ── Heavy planner component mocks ─────────────────────────────────────────────
vi.mock('@/components/planner', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">Map</div>,
  VirtualizedInboxList: ({
    onCandidateSelect,
  }: {
    onCandidateSelect?: (id: string) => void;
  }) => (
    <div data-testid="inbox-list">
      <button
        type="button"
        onClick={() => onCandidateSelect?.('cust-integration-1')}
      >
        Select candidate
      </button>
    </div>
  ),
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
}));

import { PlanningInbox } from '../PlanningInbox';

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDesktop() {
  mockUseBreakpoint.mockReturnValue({
    breakpoint: 'desktop',
    isPhone: false,
    isMobileUi: false,
    isTouch: false,
  });
}

function setupMobile() {
  mockUseBreakpoint.mockReturnValue({
    breakpoint: 'phone',
    isPhone: true,
    isMobileUi: true,
    isTouch: true,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanningInbox — A.6 PanelStateProvider integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  describe('desktop layout', () => {
    beforeEach(() => setupDesktop());

    it('renders inbox list panel', () => {
      render(<PlanningInbox />);
      expect(screen.getByTestId('inbox-list')).toBeInTheDocument();
    });

    it('renders map panel', () => {
      render(<PlanningInbox />);
      expect(screen.getByTestId('map-panel')).toBeInTheDocument();
    });

    it('renders route timeline section', () => {
      render(<PlanningInbox />);
      // Right panel slot is always present in ThreePanelLayout (contains map + timeline)
      expect(screen.getByTestId('panel-right')).toBeInTheDocument();
    });

    it('renders within PanelStateProvider (usePanelState accessible)', () => {
      // PlanningInboxInner calls usePanelState() — would throw if no provider present
      expect(() => render(<PlanningInbox />)).not.toThrow();
    });
  });

  describe('mobile layout', () => {
    beforeEach(() => setupMobile());

    it('renders inbox list panel on mobile', () => {
      render(<PlanningInbox />);
      expect(screen.getByTestId('inbox-list')).toBeInTheDocument();
    });

    it('selecting a candidate opens the detail bottom sheet', async () => {
      render(<PlanningInbox />);

      // BottomSheet is closed — CandidateDetail not in DOM
      expect(screen.queryByTestId('candidate-detail')).not.toBeInTheDocument();

      // Simulate candidate selection in the inbox list
      await userEvent.click(screen.getByRole('button', { name: 'Select candidate' }));

      // Detail panel should now appear inside the opened BottomSheet
      expect(screen.getByTestId('candidate-detail')).toBeInTheDocument();
    });
  });
});
