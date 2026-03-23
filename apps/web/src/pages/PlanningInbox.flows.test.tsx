/**
 * PlanningInbox flow tests — batch toolbar, depot guard, selection wiring.
 * Uses mock InboxListPanel to drive selection without full list virtualization.
 * Filter AST / applyInboxFilters are covered in planningInboxFilters.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { RouteJobStatusUpdate } from '../services/routeService';
import {
  createInboxResponseWithOneCandidate,
  defaultCrewList,
  defaultPlanningInboxSettings,
} from '../test/factories/services';
import { renderPlanningInbox, setupPlanningInboxDesktop } from '../test/helpers/renderPlanningInbox';

const { mockSubmitRoutePlanJob, mockSubscribeToRouteJobStatus } = vi.hoisted(() => ({
  mockSubmitRoutePlanJob: vi.fn(),
  mockSubscribeToRouteJobStatus: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => mockNavigate),
  useSearch: vi.fn(() => ({})),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(),
}));
import { useBreakpoint } from '@/hooks/useBreakpoint';
const mockUseBreakpoint = vi.mocked(useBreakpoint);

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

const mockGetSettings = vi.fn();
const mockListCrews = vi.fn();

vi.mock('../services/revisionService', () => ({
  getCallQueue: vi.fn().mockResolvedValue([]),
  snoozeRevision: vi.fn(),
  scheduleRevision: vi.fn(),
  unscheduleRevision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/crewService', () => ({
  listCrews: (...args: unknown[]) => mockListCrews(...args),
}));

vi.mock('../services/routeService', () => ({
  recalculateRoute: vi.fn().mockResolvedValue({}),
  getRoute: vi.fn().mockResolvedValue({ route: null, stops: [] }),
  saveRoute: vi.fn().mockResolvedValue({}),
  deleteRoute: vi.fn().mockResolvedValue(undefined),
  submitRoutePlanJob: (...args: unknown[]) => mockSubmitRoutePlanJob(...args),
  subscribeToRouteJobStatus: (...args: unknown[]) => mockSubscribeToRouteJobStatus(...args),
}));

vi.mock('../services/settingsService', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

vi.mock('../services/calendarService', () => ({
  listCalendarItems: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/insertionService', () => ({
  calculateInsertion: vi.fn().mockResolvedValue(null),
  calculateBatchInsertion: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock('../services/geometryService', () => ({
  submitGeometryJob: vi.fn().mockResolvedValue({ jobId: 'geom-job' }),
  subscribeToGeometryJobStatus: vi.fn().mockResolvedValue(vi.fn()),
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

vi.mock('../services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [], total: 0, overdueCount: 0, dueSoonCount: 0 }),
  listPlannedActions: vi.fn().mockResolvedValue({ items: [] }),
  updatePlannedAction: vi.fn(),
}));

vi.mock('../services/inboxAdapter', () => ({
  inboxResponseToCallQueueResponse: vi.fn().mockReturnValue(createInboxResponseWithOneCandidate()),
}));

vi.mock('../services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../panels/InboxListPanel', () => ({
  InboxListPanel: ({
    onSelectionChange,
  }: {
    selectable?: boolean;
    selectedIds: Set<string>;
    onSelectionChange?: (id: string, selected: boolean) => void;
  }) => (
    <div data-testid="inbox-list-panel-mock">
      <button
        type="button"
        data-testid="mock-select-one-candidate"
        onClick={() => onSelectionChange?.('cust-flow-1', true)}
      >
        mock-select
      </button>
    </div>
  ),
}));

vi.mock('../panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel-detached">Map detached</div>,
}));

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

vi.mock('../components/common', () => ({
  CollapseButton: () => null,
  SplitView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ThreePanelLayout: ({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="three-panel-layout">
      <div>{left}</div>
      <div>{center}</div>
      <div>{right}</div>
    </div>
  ),
}));

vi.mock('../components/layout', () => ({
  SplitLayout: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="split-layout">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  ),
  LayoutManager: () => null,
  DetachButton: () => null,
  MapPanelShell: ({ panelName, children }: { panelName: string; children: React.ReactNode }) => (
    <div data-testid="map-panel-shell" data-panel={panelName}>{children}</div>
  ),
}));

import { PlanningInbox } from './PlanningInbox';

function completedBatchOptimizeUpdate(jobId: string): RouteJobStatusUpdate {
  return {
    jobId,
    timestamp: new Date().toISOString(),
    status: {
      type: 'completed',
      result: {
        stops: [
          {
            customerId: 'cust-flow-1',
            customerName: 'Flow Customer',
            address: 'Test 1, Prague',
            coordinates: { lat: 50.0755, lng: 14.4378 },
            order: 1,
            eta: '09:00',
            etd: '09:30',
            serviceDurationMinutes: 30,
          },
        ],
        totalDistanceKm: 5,
        totalDurationMinutes: 60,
        algorithm: 'test',
        solveTimeMs: 1,
        solverLog: [],
        optimizationScore: 90,
        warnings: [],
        unassigned: [],
      },
    },
  };
}

describe('PlanningInbox flows (desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    sessionStorage.clear();
    mockGetSettings.mockResolvedValue(defaultPlanningInboxSettings());
    mockListCrews.mockResolvedValue(defaultCrewList());
    mockSubmitRoutePlanJob.mockResolvedValue({
      jobId: 'flow-job',
      position: 0,
      estimatedWaitSeconds: 0,
    });
    mockSubscribeToRouteJobStatus.mockResolvedValue(() => {});
  });

  it('enables Add to Route & Optimize after selection when depot is configured', async () => {
    setupPlanningInboxDesktop(mockUseBreakpoint);

    const { user } = renderPlanningInbox(<PlanningInbox />);

    await user.click(screen.getByTestId('mock-select-one-candidate'));

    const addBtn = await screen.findByRole('button', { name: 'add_to_route_optimize' });
    await waitFor(() => {
      expect(addBtn).not.toBeDisabled();
    });
  });

  it('disables Add to Route & Optimize when no depot in context', async () => {
    mockGetSettings.mockResolvedValue(null);
    mockListCrews.mockResolvedValue([]);

    setupPlanningInboxDesktop(mockUseBreakpoint);

    const { user } = renderPlanningInbox(<PlanningInbox />);

    await user.click(screen.getByTestId('mock-select-one-candidate'));

    const addBtn = await screen.findByRole('button', { name: 'add_to_route_optimize' });
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveAttribute('title', 'batch_no_depot');
  });

  it('shows selection toolbar with selected_count then clears on cancel', async () => {
    setupPlanningInboxDesktop(mockUseBreakpoint);

    const { user } = renderPlanningInbox(<PlanningInbox />);

    await user.click(screen.getByTestId('mock-select-one-candidate'));

    expect(await screen.findByText('selected_count')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'cancel_selection' }));

    expect(screen.queryByRole('button', { name: 'add_to_route_optimize' })).not.toBeInTheDocument();
    expect(screen.queryByText('selected_count')).not.toBeInTheDocument();
  });

  it('submits batch route plan job with depot start location when Add to Route & Optimize is clicked', async () => {
    mockSubscribeToRouteJobStatus.mockImplementationOnce(async (jobId: string, callback: (u: RouteJobStatusUpdate) => void) => {
      queueMicrotask(() => {
        callback(completedBatchOptimizeUpdate(jobId));
      });
      return () => {};
    });

    setupPlanningInboxDesktop(mockUseBreakpoint);

    const { user } = renderPlanningInbox(<PlanningInbox />);

    await user.click(screen.getByTestId('mock-select-one-candidate'));

    const addBtn = await screen.findByRole('button', { name: 'add_to_route_optimize' });
    await waitFor(() => {
      expect(addBtn).not.toBeDisabled();
    });

    await user.click(addBtn);

    await waitFor(() => {
      expect(mockSubmitRoutePlanJob).toHaveBeenCalled();
    });

    expect(mockSubmitRoutePlanJob).toHaveBeenCalledWith(
      expect.objectContaining({
        customerIds: expect.arrayContaining(['cust-flow-1']),
        startLocation: { lat: 50.1, lng: 14.3 },
        crewId: 'crew-1',
      }),
    );
    expect(mockSubscribeToRouteJobStatus).toHaveBeenCalledWith('flow-job', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// Collapse UI removed assertions
// ---------------------------------------------------------------------------

describe('PlanningInbox — collapse UI removed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetSettings.mockResolvedValue(defaultPlanningInboxSettings());
    mockListCrews.mockResolvedValue(defaultCrewList());
    mockSubmitRoutePlanJob.mockResolvedValue({ jobId: 'flow-job', position: 0, estimatedWaitSeconds: 0 });
    mockSubscribeToRouteJobStatus.mockResolvedValue(() => {});
  });

  it('has no section-header collapse/expand button for Map or Timeline panels', async () => {
    setupPlanningInboxDesktop(mockUseBreakpoint);
    renderPlanningInbox(<PlanningInbox />);

    await waitFor(() => screen.getByTestId('inbox-list-panel-mock'));

    expect(screen.queryByTitle(/Sbalit|Rozbalit|collapse|expand/i)).not.toBeInTheDocument();
    expect(screen.queryByText('▲')).not.toBeInTheDocument();
    expect(screen.queryByText('▼')).not.toBeInTheDocument();
  });

  it('has no mapCollapsedBar element', async () => {
    setupPlanningInboxDesktop(mockUseBreakpoint);
    renderPlanningInbox(<PlanningInbox />);

    await waitFor(() => screen.getByTestId('inbox-list-panel-mock'));

    expect(screen.queryByTestId('map-collapsed-bar')).not.toBeInTheDocument();
  });

  it('does not read sazinka.inbox.timelineCollapsed from localStorage on mount', async () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem');

    setupPlanningInboxDesktop(mockUseBreakpoint);
    renderPlanningInbox(<PlanningInbox />);

    await waitFor(() => screen.getByTestId('inbox-list-panel-mock'));

    const collapseReads = getSpy.mock.calls.filter(
      ([key]) => key === 'sazinka.inbox.timelineCollapsed',
    );
    expect(collapseReads).toHaveLength(0);
  });

  it('does not read sazinka.inbox.mapCollapsed from localStorage on mount', async () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem');

    setupPlanningInboxDesktop(mockUseBreakpoint);
    renderPlanningInbox(<PlanningInbox />);

    await waitFor(() => screen.getByTestId('inbox-list-panel-mock'));

    const collapseReads = getSpy.mock.calls.filter(
      ([key]) => key === 'sazinka.inbox.mapCollapsed',
    );
    expect(collapseReads).toHaveLength(0);
  });

  it('Inbox map wrapper renders data-testid="map-panel-shell"', async () => {
    setupPlanningInboxDesktop(mockUseBreakpoint);
    renderPlanningInbox(<PlanningInbox />);

    await waitFor(() => screen.getByTestId('inbox-list-panel-mock'));

    expect(screen.getByTestId('map-panel-shell')).toBeInTheDocument();
  });
});
