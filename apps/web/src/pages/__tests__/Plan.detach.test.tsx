/**
 * G.5b — Detach wiring tests for Plan page.
 * Only the Map panel is detachable from the Plan page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: false }),
}));

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobileUi: false, isTablet: false }),
}));

vi.mock('@/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ mode: 'wide', setMode: vi.fn() }),
}));

vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="route-map-panel">Map</div>,
}));

vi.mock('@/panels/CustomerDetailPanel', () => ({
  CustomerDetailPanel: () => <div data-testid="customer-detail-panel">Detail</div>,
}));

vi.mock('@/components/planner', () => ({
  RouteListPanel: () => <div data-testid="route-list-panel">RouteList</div>,
  RouteDetailTimeline: () => <div data-testid="route-timeline">Timeline</div>,
  RouteMapPanel: () => <div data-testid="planner-map">PlannerMap</div>,
  PlanningTimeline: () => <div data-testid="planning-timeline">PlanningTimeline</div>,
  TimelineViewToggle: () => <div data-testid="timeline-toggle">Toggle</div>,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
}));

vi.mock('@/components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters">Filters</div>,
}));

vi.mock('@/components/layout', () => ({
  SplitLayout: ({ first, second }: { first: React.ReactNode; second: React.ReactNode }) => (
    <div data-testid="split-layout">{first}{second}</div>
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
  listRoutes: vi.fn().mockResolvedValue([]),
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

vi.mock('@/services/settingsService', () => ({
  getBreakSettings: vi.fn().mockResolvedValue(null),
  getDepots: vi.fn().mockResolvedValue([]),
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
// Import component AFTER mocks
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Plan } = await import('../Plan');

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

describe('Plan — detach wiring (G.5b)', () => {
  it('renders Map panel when not detached', async () => {
    render(<Plan />);
    await waitFor(() => expect(screen.getByTestId('route-map-panel')).toBeInTheDocument());
  });

  it('shows detach button on Map panel', async () => {
    render(<Plan />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());
  });

  it('does NOT show detach button on RouteList', async () => {
    render(<Plan />);
    await waitFor(() => expect(screen.getByTestId('route-list-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('detach-routelist-btn')).not.toBeInTheDocument();
  });

  it('hides Map panel when map is detached', async () => {
    render(<Plan />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-map-btn'));

    await waitFor(() => expect(screen.queryByTestId('route-map-panel')).not.toBeInTheDocument());
  });

  it('shows Map panel again when detached window closes', async () => {
    render(<Plan />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-map-btn'));
    await waitFor(() => expect(screen.queryByTestId('route-map-panel')).not.toBeInTheDocument());

    mockWin.closed = true;
    await waitFor(
      () => expect(screen.getByTestId('route-map-panel')).toBeInTheDocument(),
      { timeout: 3000 }
    );
  }, 10000);

  it('detach URL uses page=plan', async () => {
    render(<Plan />);
    await waitFor(() => expect(screen.getByTestId('detach-map-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('detach-map-btn'));

    const calledUrl = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('page=plan');
  });
});
