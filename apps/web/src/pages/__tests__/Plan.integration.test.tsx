/**
 * A.7 Integration test — Plan page with PanelStateProvider
 *
 * Verifies that Plan is wrapped in PanelStateProvider and key layout
 * sections render correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ── Router mock ────────────────────────────────────────────────────────────────
vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ── NATS store mock — connected so effects can fire ───────────────────────────
vi.mock('../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

// ── Planner UI component mocks (barrel) ───────────────────────────────────────
vi.mock('@/components/planner', () => ({
  RouteListPanel: () => <div data-testid="route-list" />,
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  RouteMapPanel: () => <div data-testid="route-map" />,
  PlanningTimeline: () => <div data-testid="planning-timeline" />,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  CandidateDetail: () => <div data-testid="candidate-detail" />,
}));

// ── PlannerFilters mock ───────────────────────────────────────────────────────
vi.mock('../../components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters" />,
}));

// ── Service mocks ─────────────────────────────────────────────────────────────
import * as routeService from '../../services/routeService';
import * as settingsService from '../../services/settingsService';

vi.mock('../../services/routeService', () => ({
  listRoutes: vi.fn().mockResolvedValue({ routes: [] }),
  getRoute: vi.fn().mockResolvedValue({ route: null, stops: [] }),
  deleteRoute: vi.fn().mockResolvedValue(undefined),
  submitRoutePlanJob: vi.fn().mockResolvedValue({ jobId: 'test-job' }),
  subscribeToRouteJobStatus: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue({
    depots: [],
    breakSettings: null,
    workConstraints: null,
    preferences: null,
  }),
}));

vi.mock('../../services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/geometryService', () => ({
  submitGeometryJob: vi.fn().mockResolvedValue({ jobId: 'geo-job' }),
  subscribeToGeometryJobStatus: vi.fn().mockResolvedValue(() => {}),
}));

// ── SUT ───────────────────────────────────────────────────────────────────────
import { Plan } from '../Plan';

describe('Plan page — A.7 PanelStateProvider integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );
  });

  it('renders route list panel', () => {
    const { container } = render(<Plan />);
    expect(container.querySelector('[class*="routeListSection"]')).toBeInTheDocument();
  });

  it('renders map panel', () => {
    const { container } = render(<Plan />);
    expect(container.querySelector('[class*="mapWrapper"]')).toBeInTheDocument();
  });

  it('renders timeline panel when a route is selected', async () => {
    const mockRoute = {
      id: 'route-1',
      userId: 'u1',
      crewId: null,
      depotId: null,
      date: '2026-03-16',
      status: 'saved',
      totalDistanceKm: null,
      totalDurationMinutes: null,
      optimizationScore: null,
      arrivalBufferPercent: 10,
      arrivalBufferFixedMinutes: 0,
      returnToDepotDistanceKm: null,
      returnToDepotDurationMinutes: null,
      createdAt: '2026-03-16T00:00:00Z',
      updatedAt: '2026-03-16T00:00:00Z',
    };

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );
    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops: [] } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );

    const { container } = render(<Plan />);

    await waitFor(() => {
      expect(container.querySelector('[class*="routeDetailSection"]')).toBeInTheDocument();
    });
  });

  it('renders within PanelStateProvider', () => {
    // CustomerDetailPanel always calls usePanelState().
    // Without PanelStateProvider wrapping Plan, rendering would throw.
    expect(() => render(<Plan />)).not.toThrow();
  });

  it('CustomerDetailPanel is rendered in plan mode (hidden by default)', () => {
    render(<Plan />);
    // isDetailOpen defaults to false → CustomerDetailPanel returns null
    expect(screen.queryByTestId('customer-detail-panel')).not.toBeInTheDocument();
  });
});
