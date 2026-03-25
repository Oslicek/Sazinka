/**
 * P1-1 + P3-2 — Plan page persistence tests
 *
 * Covers:
 *  P1-1: selectedRouteId persists across unmount/remount via UPP session channel
 *  P3-2: timelineView persists across unmount/remount via UPP session channel
 *
 * TDD: RED tests written before implementing UPP wiring in Plan.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { makeEnvelope, makeKey } from '../persistence/core/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean; request: unknown }) => unknown) => {
    const state = { isConnected: true, request: vi.fn() };
    return selector ? selector(state) : state;
  }),
}));

const TEST_USER_ID = 'persist-test-user';

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

let capturedSelectedRouteId: string | null | undefined;
let capturedTimelineView: string | undefined;

vi.mock('../components/planner', () => ({
  RouteListPanel: ({ selectedRouteId }: { selectedRouteId: string | null }) => {
    capturedSelectedRouteId = selectedRouteId;
    return <div data-testid="route-list-panel" data-selected={selectedRouteId ?? ''} />;
  },
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  RouteMapPanel: () => <div data-testid="route-map-panel" />,
  PlanningTimeline: () => null,
  TimelineViewToggle: ({ value }: { value: string }) => {
    capturedTimelineView = value;
    return <div data-testid="timeline-view-toggle" data-view={value} />;
  },
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
}));

vi.mock('../components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters" />,
}));

vi.mock('../services/routeService', () => ({
  getRoute: vi.fn().mockResolvedValue({ route: null, stops: [] }),
  listRoutes: vi.fn().mockResolvedValue({ routes: [] }),
  saveRoute: vi.fn(),
  recalculateRoute: vi.fn(),
  deleteRoute: vi.fn(),
}));

vi.mock('../services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/geometryService', () => ({
  calculateRouteShape: vi.fn().mockResolvedValue(null),
}));

vi.mock('../panels/CustomerDetailPanel', () => ({
  CustomerDetailPanel: () => null,
}));

vi.mock('../panels/RouteMapPanel', () => ({
  RouteMapPanel: () => null,
}));

vi.mock('../components/layout', () => ({
  MapPanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

import * as routeService from '../services/routeService';

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: 'plan.filters', controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

function makeRoute(id: string) {
  return {
    id,
    name: `Route ${id}`,
    date: '2026-03-01',
    crewId: null,
    depotId: null,
    stops: [],
    status: 'draft' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

import { Plan } from './Plan';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Plan page — persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    capturedSelectedRouteId = undefined;
    capturedTimelineView = undefined;
    vi.clearAllMocks();
    vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [] });
    vi.mocked(routeService.getRoute).mockResolvedValue({ route: null, stops: [] });
  });

  // ── P1-1: selectedRouteId ──────────────────────────────────────────────────

  describe('P1-1: selectedRouteId persistence', () => {
    it('restores persisted route selection on remount', async () => {
      const ROUTE_A = makeRoute('route-a');
      const ROUTE_B = makeRoute('route-b');
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [ROUTE_A, ROUTE_B] });

      seedUpp('selectedRouteId', ROUTE_B.id);

      render(<Plan />);

      await waitFor(() => {
        expect(capturedSelectedRouteId).toBe(ROUTE_B.id);
      });
    });

    it('falls back to first route when persisted ID is no longer in the list', async () => {
      const ROUTE_A = makeRoute('route-a');
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [ROUTE_A] });

      seedUpp('selectedRouteId', 'stale-route-id');

      render(<Plan />);

      await waitFor(() => {
        expect(capturedSelectedRouteId).toBe(ROUTE_A.id);
      });
    });

    it('survives two unmount/remount cycles', async () => {
      const ROUTE_B = makeRoute('route-b');
      vi.mocked(routeService.listRoutes).mockResolvedValue({
        routes: [makeRoute('route-a'), ROUTE_B],
      });

      seedUpp('selectedRouteId', ROUTE_B.id);

      // Cycle 1
      const { unmount: unmount1 } = render(<Plan />);
      await waitFor(() => expect(capturedSelectedRouteId).toBe(ROUTE_B.id));
      unmount1();

      capturedSelectedRouteId = undefined;

      // Cycle 2
      const { unmount: unmount2 } = render(<Plan />);
      await waitFor(() => expect(capturedSelectedRouteId).toBe(ROUTE_B.id));
      unmount2();
    });

    it('handles null/missing persisted value gracefully (no crash)', async () => {
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [] });

      render(<Plan />);

      await waitFor(() => {
        expect(capturedSelectedRouteId).toBeNull();
      });
    });

    it('handles corrupted storage value by falling back to first route', async () => {
      const ROUTE_A = makeRoute('route-a');
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [ROUTE_A] });

      // Write a non-string into the UPP slot
      const key = makeKey({
        userId: TEST_USER_ID,
        profileId: 'plan.filters',
        controlId: 'selectedRouteId',
      });
      sessionStorage.setItem(key, 'not-a-valid-envelope');

      render(<Plan />);

      await waitFor(() => {
        expect(capturedSelectedRouteId).toBe(ROUTE_A.id);
      });
    });
  });

  // ── P3-2: timelineView ─────────────────────────────────────────────────────
  // TimelineViewToggle only renders inside {selectedRoute && ...}, so we need
  // a route that matches selectedRouteId so selectedRoute is truthy.

  describe('P3-2: timelineView persistence', () => {
    it('restores persisted timelineView on remount', async () => {
      const ROUTE_A = makeRoute('route-a');
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [ROUTE_A] });
      seedUpp('selectedRouteId', ROUTE_A.id);
      seedUpp('timelineView', 'compact');

      render(<Plan />);

      await waitFor(() => {
        expect(capturedTimelineView).toBe('compact');
      });
    });

    it('survives two unmount/remount cycles', async () => {
      const ROUTE_A = makeRoute('route-a');
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [ROUTE_A] });
      seedUpp('selectedRouteId', ROUTE_A.id);
      seedUpp('timelineView', 'compact');

      const { unmount: unmount1 } = render(<Plan />);
      await waitFor(() => expect(capturedTimelineView).toBe('compact'));
      unmount1();

      capturedTimelineView = undefined;

      const { unmount: unmount2 } = render(<Plan />);
      await waitFor(() => expect(capturedTimelineView).toBe('compact'));
      unmount2();
    });

    it('falls back to "planning" for invalid persisted value', async () => {
      const ROUTE_A = makeRoute('route-a');
      vi.mocked(routeService.listRoutes).mockResolvedValue({ routes: [ROUTE_A] });
      seedUpp('selectedRouteId', ROUTE_A.id);
      seedUpp('timelineView', 'bogus-view');

      render(<Plan />);

      await waitFor(() => {
        expect(capturedTimelineView).toBe('planning');
      });
    });
  });

  // ── Profile isolation ──────────────────────────────────────────────────────
  // Both selectedRouteId and timelineView must survive independently.
  // TimelineViewToggle renders only when selectedRoute is truthy.

  it('updating timelineView does not clobber selectedRouteId (profile isolation)', async () => {
    const ROUTE_B = makeRoute('route-b');
    vi.mocked(routeService.listRoutes).mockResolvedValue({
      routes: [makeRoute('route-a'), ROUTE_B],
    });

    seedUpp('selectedRouteId', ROUTE_B.id);
    seedUpp('timelineView', 'compact');

    render(<Plan />);

    await waitFor(() => {
      // selectedRouteId comes from RouteListPanel prop capture
      expect(capturedSelectedRouteId).toBe(ROUTE_B.id);
    });
    // timelineView visible only after selectedRoute resolves to ROUTE_B
    await waitFor(() => {
      expect(capturedTimelineView).toBe('compact');
    });
  });
});
