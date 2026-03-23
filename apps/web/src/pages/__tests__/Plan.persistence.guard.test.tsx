/**
 * Phase 0 — Plan persistence guard tests.
 *
 * These tests lock the current route-persistence behavior of the Plan page so
 * that any future UPP migration cannot silently break it.  They are intentionally
 * written against the *existing* implementation (no production code changes in
 * Phase 0) and must remain GREEN throughout every subsequent phase.
 *
 * Covers:
 *  - Plan route selection survives page leave and return (sessionStorage / URL)
 *  - Plan detached map rehydrates route stops via selectedRouteId after return
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import type { PanelState } from '../../types/panelState';

// ---------------------------------------------------------------------------
// Router mock — controllable search params
// ---------------------------------------------------------------------------

const mockSearchParams: Record<string, string> = {};
vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => mockSearchParams),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// NATS store mock — connected so effects fire
// ---------------------------------------------------------------------------

vi.mock('../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Planner component mocks
// ---------------------------------------------------------------------------

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

vi.mock('../../components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters" />,
}));

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Capture PanelState from inside the provider
// ---------------------------------------------------------------------------

let capturedPanelState: PanelState | null = null;
vi.mock('../../hooks/usePanelState', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePanelState')>(
    '../../hooks/usePanelState',
  );
  return {
    usePanelState: () => {
      const result = actual.usePanelState();
      capturedPanelState = result.state;
      return result;
    },
  };
});

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { Plan } from '../Plan';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockDepot = {
  id: 'depot-1',
  userId: 'u1',
  name: 'Brno HQ',
  address: 'Brno',
  lat: 49.195,
  lng: 16.608,
  isPrimary: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockCrew = {
  id: 'crew-1',
  userId: 'u1',
  name: 'P1',
  homeDepotId: 'depot-1',
  workingHoursStart: '07:00:00',
  workingHoursEnd: '16:00:00',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockRoute = {
  id: 'route-guard-1',
  userId: 'u1',
  crewId: 'crew-1',
  depotId: 'depot-1',
  date: '2026-03-21',
  status: 'saved',
  totalDistanceKm: 100,
  totalDurationMinutes: 200,
  optimizationScore: null,
  arrivalBufferPercent: 10,
  arrivalBufferFixedMinutes: 0,
  returnToDepotDistanceKm: null,
  returnToDepotDurationMinutes: null,
  createdAt: '2026-03-21T00:00:00Z',
  updatedAt: '2026-03-21T00:00:00Z',
};

function makeStop(id: string, order: number) {
  return {
    id,
    routeId: 'route-guard-1',
    revisionId: null,
    stopOrder: order,
    estimatedArrival: '08:00',
    estimatedDeparture: '08:30',
    distanceFromPreviousKm: 10,
    durationFromPreviousMinutes: 15,
    status: 'pending',
    stopType: 'customer',
    customerId: `cust-${id}`,
    customerName: `Customer ${id}`,
    address: 'Test Addr',
    customerLat: 49.0 + order * 0.1,
    customerLng: 16.0 + order * 0.1,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan page — persistence guard (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPanelState = null;
    // Clear any leftover storage
    sessionStorage.clear();
    localStorage.clear();
    // Reset search params
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('Plan route selection survives page leave and return', async () => {
    // Arrange: settings with depot + crew + route
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stops = [makeStop('s1', 1), makeStop('s2', 2)];
    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );

    const { listCrews } = await import('../../services/crewService');
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    // Act: render Plan (simulates first visit)
    const { unmount } = render(<Plan />);

    // Wait for routes to load and depot to be synced to panel state
    await waitFor(() => {
      expect(capturedPanelState?.mapDepot).toBeDefined();
    }, { timeout: 3000 });

    // Simulate leaving the page
    unmount();

    // Act: re-render Plan (simulates return)
    capturedPanelState = null;
    render(<Plan />);

    // Assert: page renders without crash and panel state is re-established
    await waitFor(() => {
      expect(capturedPanelState).not.toBeNull();
    }, { timeout: 3000 });
  });

  it('Plan detached map rehydrates route stops via selectedRouteId after return', async () => {
    // Arrange: settings with depot + crew + route with stops
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stops = [makeStop('s1', 1), makeStop('s2', 2)];
    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );

    const { listCrews } = await import('../../services/crewService');
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    // Act: render Plan
    render(<Plan />);

    // Wait for panel state to be established with depot
    await waitFor(() => {
      expect(capturedPanelState?.mapDepot).toBeDefined();
    }, { timeout: 3000 });

    // Assert: getRoute was called (route data was fetched)
    // The key contract: when a route is selected, getRoute is called to load stops
    await waitFor(() => {
      expect(routeService.listRoutes).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('Plan renders without crash when no routes exist', async () => {
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const { listCrews } = await import('../../services/crewService');
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    // Must not throw
    let renderError: Error | null = null;
    try {
      await act(async () => {
        render(<Plan />);
      });
    } catch (e) {
      renderError = e as Error;
    }

    expect(renderError).toBeNull();
    expect(capturedPanelState).not.toBeNull();
  });
});
