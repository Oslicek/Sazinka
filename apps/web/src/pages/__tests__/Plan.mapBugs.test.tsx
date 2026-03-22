/**
 * Tests for BUG-1, BUG-2, BUG-3 — Plan page map integration.
 *
 * BUG-1: Plan page never syncs depot to PanelState → map has no depot marker or route lines.
 * BUG-2: Navigating to Plan and back loses route geometry (side-effect of BUG-1).
 * BUG-3: Clicking a stop in Plan timeline doesn't highlight it on the map.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import type { PanelState } from '../../types/panelState';

// ---------------------------------------------------------------------------
// Capture props passed to mocked planner components
// ---------------------------------------------------------------------------

const capturedTimelineProps = { current: {} as Record<string, unknown> };
const capturedMapProps = { current: {} as Record<string, unknown> };

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/components/planner', () => ({
  RouteListPanel: () => <div data-testid="route-list" />,
  RouteDetailTimeline: (props: Record<string, unknown>) => {
    capturedTimelineProps.current = { ...props };
    return <div data-testid="route-detail-timeline" />;
  },
  RouteMapPanel: (props: Record<string, unknown>) => {
    capturedMapProps.current = { ...props };
    return <div data-testid="route-map" />;
  },
  PlanningTimeline: (props: Record<string, unknown>) => {
    capturedTimelineProps.current = { ...props };
    return <div data-testid="planning-timeline" />;
  },
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

// Capture PanelState from inside the provider
let capturedPanelState: PanelState | null = null;
vi.mock('../../hooks/usePanelState', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePanelState')>('../../hooks/usePanelState');
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

const mockRoute = {
  id: 'route-1',
  userId: 'u1',
  crewId: 'crew-1',
  depotId: 'depot-1',
  date: '2026-03-21',
  status: 'saved',
  totalDistanceKm: 234.9,
  totalDurationMinutes: 352,
  optimizationScore: null,
  arrivalBufferPercent: 10,
  arrivalBufferFixedMinutes: 0,
  returnToDepotDistanceKm: null,
  returnToDepotDurationMinutes: null,
  createdAt: '2026-03-21T00:00:00Z',
  updatedAt: '2026-03-21T00:00:00Z',
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

function makeStop(id: string, order: number) {
  return {
    id,
    routeId: 'route-1',
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

describe('Plan page — map bugs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPanelState = null;
    capturedTimelineProps.current = {};
    capturedMapProps.current = {};
  });

  it('BUG-1: syncs depot to PanelState (mapDepot) when a route is selected', async () => {
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

    render(<Plan />);

    await waitFor(() => {
      expect(capturedPanelState).not.toBeNull();
      expect(capturedPanelState!.mapDepot).toEqual(
        expect.objectContaining({ lat: mockDepot.lat, lng: mockDepot.lng }),
      );
    }, { timeout: 3000 });
  });

  it('BUG-3: clicking a stop in the timeline sets selectedCustomerId in PanelState', async () => {
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

    render(<Plan />);

    // Wait for the timeline to receive its onStopClick prop
    await waitFor(() => {
      expect(capturedTimelineProps.current.onStopClick).toBeDefined();
    }, { timeout: 3000 });

    const onStopClick = capturedTimelineProps.current.onStopClick as (
      customerId: string,
      index: number,
    ) => void;

    act(() => {
      onStopClick('cust-s1', 0);
    });

    expect(capturedPanelState!.selectedCustomerId).toBe('cust-s1');
  });
});
