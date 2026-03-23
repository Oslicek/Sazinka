/**
 * Integration tests for Print and Export functionality on the Plan page.
 *
 * Phase 5 of the Print/Export implementation plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { PanelState, PanelActions } from '../../types/panelState';

// ---------------------------------------------------------------------------
// Capture what Plan passes to RouteSummaryActions
// ---------------------------------------------------------------------------

type RouteSummaryActionsCapture = {
  onPrint?: () => void;
  onExportGoogleMaps?: () => void;
  canPrint?: boolean;
  canExport?: boolean;
};
const capturedSummaryActions: { current: RouteSummaryActionsCapture } = { current: {} };

// Capture PanelState + PanelActions from inside the provider
let capturedPanelState: PanelState | null = null;
let capturedPanelActions: PanelActions | null = null;

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
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  RouteMapPanel: () => <div data-testid="route-map" />,
  PlanningTimeline: () => <div data-testid="planning-timeline" />,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: (props: RouteSummaryActionsCapture) => {
    capturedSummaryActions.current = { ...props };
    return (
      <div data-testid="summary-actions">
        {props.onPrint && (
          <button
            data-testid="print-btn"
            onClick={props.onPrint}
            disabled={props.canPrint === false}
          >
            Print
          </button>
        )}
        {props.onExportGoogleMaps && (
          <button
            data-testid="export-btn"
            onClick={props.onExportGoogleMaps}
            disabled={props.canExport === false}
          >
            Export
          </button>
        )}
      </div>
    );
  },
  ArrivalBufferBar: () => null,
  CandidateDetail: () => <div data-testid="candidate-detail" />,
}));

vi.mock('../../components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters" />,
}));

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

// Mock the smart panel wrapper so it doesn't independently call routeService.
// We test canPrint / canExport gating by calling capturedPanelActions directly.
vi.mock('../../panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel-wrapper" />,
}));

vi.mock('../../hooks/usePanelState', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePanelState')>('../../hooks/usePanelState');
  return {
    usePanelState: () => {
      const result = actual.usePanelState();
      capturedPanelState = result.state;
      capturedPanelActions = result.actions;
      return result;
    },
  };
});

// ---------------------------------------------------------------------------
// Service mocks imports
// ---------------------------------------------------------------------------

import * as routeService from '../../services/routeService';
import * as settingsService from '../../services/settingsService';
import { listCrews } from '../../services/crewService';

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
  totalDistanceKm: 150,
  totalDurationMinutes: 300,
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

function makeStop(id: string, order: number, opts: { lat?: number; lng?: number; stopType?: 'customer' | 'break' } = {}) {
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
    stopType: opts.stopType ?? 'customer',
    customerId: `cust-${id}`,
    customerName: `Customer ${id}`,
    address: 'Test Addr',
    customerLat: opts.lat ?? 49.0 + order * 0.1,
    customerLng: opts.lng ?? 16.0 + order * 0.1,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
  };
}

async function setupRouteAndWait() {
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

  vi.mocked(listCrews).mockResolvedValue(
    [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
  );

  render(<Plan />);

  // Wait for RouteSummaryActions to receive the new props (route selected, stops loaded)
  await waitFor(() => {
    expect(capturedSummaryActions.current.onPrint).toBeDefined();
  }, { timeout: 3000 });

  return stops;
}

// ---------------------------------------------------------------------------
// window.open mock helpers
// ---------------------------------------------------------------------------

function makeFakeWindow() {
  const writtenHtml: string[] = [];
  const fakeDoc = {
    write: vi.fn((s: string) => writtenHtml.push(s)),
    close: vi.fn(),
  };
  const fakeWin = {
    document: fakeDoc,
    print: vi.fn(),
    onload: null as (() => void) | null,
    _writtenHtml: writtenHtml,
  };
  return fakeWin;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan page — Print & Export', () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedPanelState = null;
    capturedPanelActions = null;
    capturedSummaryActions.current = {};
    if (windowOpenSpy) {
      windowOpenSpy.mockRestore();
    }
    windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  // #1 — Print flow opens window and writes document
  it('print flow opens window and writes HTML document', async () => {
    const fakeWin = makeFakeWindow();
    windowOpenSpy.mockReturnValue(fakeWin as unknown as Window);

    await setupRouteAndWait();

    // Enable mapReady so print is not blocked
    act(() => {
      capturedPanelActions!.setMapReady(true);
    });
    // Register a fake capture so captureMap returns something
    act(() => {
      capturedPanelActions!.registerMapCapture(() => 'data:image/png;base64,FAKE');
    });

    act(() => {
      capturedSummaryActions.current.onPrint!();
    });

    expect(windowOpenSpy).toHaveBeenCalledWith('', '_blank');
    expect(fakeWin.document.write).toHaveBeenCalled();
    const written = fakeWin._writtenHtml.join('');
    expect(written).toContain('<!DOCTYPE html');
  });

  // #2 — Export opens Google Maps URL
  it('export opens Google Maps URL in new tab', async () => {

    await setupRouteAndWait();

    await waitFor(() => {
      expect(capturedSummaryActions.current.canExport).toBe(true);
    });

    act(() => {
      capturedSummaryActions.current.onExportGoogleMaps!();
    });

    await waitFor(() => {
      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('google.com/maps/dir'),
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  // #3 — Export disabled when canExport false (all breaks)
  it('canExport is false when all stops are breaks', async () => {
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stops = [makeStop('b1', 1, { stopType: 'break' }), makeStop('b2', 2, { stopType: 'break' })];
    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    render(<Plan />);

    await waitFor(() => {
      expect(capturedSummaryActions.current.canExport).toBe(false);
    }, { timeout: 3000 });
  });

  // #4 — Print disabled when mapReady is false
  it('canPrint is false when mapReady is false', async () => {
    await setupRouteAndWait();

    // mapReady defaults to false
    expect(capturedPanelState!.mapReady).toBe(false);
    expect(capturedSummaryActions.current.canPrint).toBe(false);
  });

  // #4b — Print enabled when mapReady is true and stops exist
  it('canPrint is true when mapReady becomes true and stops exist', async () => {
    await setupRouteAndWait();

    act(() => {
      capturedPanelActions!.setMapReady(true);
    });

    await waitFor(() => {
      expect(capturedSummaryActions.current.canPrint).toBe(true);
    });
  });

  // #5 — Export warning banner appears on truncation/skip warnings
  it('export warning banner appears when warnings are returned', async () => {
    // Use stops with null coords to trigger SKIPPED_NO_COORDS warning
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stops = [
      makeStop('s1', 1, { lat: undefined, lng: undefined }),
      makeStop('s2', 2),
    ];
    // Force null coords for s1
    stops[0].customerLat = null as unknown as number;
    stops[0].customerLng = null as unknown as number;

    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    render(<Plan />);

    await waitFor(() => {
      expect(capturedSummaryActions.current.onExportGoogleMaps).toBeDefined();
    }, { timeout: 3000 });

    act(() => {
      capturedSummaryActions.current.onExportGoogleMaps!();
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  // #6 — Export warning banner can be dismissed
  it('export warning banner can be dismissed', async () => {
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stops = [makeStop('s1', 1, { lat: undefined, lng: undefined }), makeStop('s2', 2)];
    stops[0].customerLat = null as unknown as number;
    stops[0].customerLng = null as unknown as number;

    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    render(<Plan />);
    await waitFor(() => {
      expect(capturedSummaryActions.current.onExportGoogleMaps).toBeDefined();
    }, { timeout: 3000 });

    act(() => {
      capturedSummaryActions.current.onExportGoogleMaps!();
    });

    const banner = await screen.findByRole('status');
    const dismissBtn = banner.querySelector('button');
    expect(dismissBtn).not.toBeNull();

    act(() => {
      fireEvent.click(dismissBtn!);
    });

    expect(screen.queryByRole('status')).toBeNull();
  });

  // #7 — Print fallback when capture returns null
  it('print succeeds even when captureMap returns null — HTML omits <img>', async () => {
    const fakeWin = makeFakeWindow();
    windowOpenSpy.mockReturnValue(fakeWin as unknown as Window);

    await setupRouteAndWait();

    act(() => {
      capturedPanelActions!.setMapReady(true);
    });
    // No capture registered → captureMap returns null

    act(() => {
      capturedSummaryActions.current.onPrint!();
    });

    const written = fakeWin._writtenHtml.join('');
    expect(written).toContain('<!DOCTYPE html');
    expect(written).not.toContain('<img');
  });

  // #8 — Export with zero warnings → no banner shown
  it('no banner is shown when export produces no warnings', async () => {
    await setupRouteAndWait();

    // Wait for depot to be synced so buildGoogleMapsUrl gets an origin (no NO_DEPOT warning)
    await waitFor(() => {
      expect(capturedPanelState!.mapDepot).not.toBeNull();
    }, { timeout: 3000 });

    act(() => {
      capturedSummaryActions.current.onExportGoogleMaps!();
    });

    // All stops have valid coords and depot is set → no warnings
    expect(screen.queryByRole('status')).toBeNull();
  });

  // #9 — Print with map capture → HTML contains <img
  it('print with successful map capture → HTML contains map image', async () => {
    const fakeWin = makeFakeWindow();
    windowOpenSpy.mockReturnValue(fakeWin as unknown as Window);

    await setupRouteAndWait();

    act(() => {
      capturedPanelActions!.setMapReady(true);
    });
    act(() => {
      capturedPanelActions!.registerMapCapture(() => 'data:image/png;base64,REALDATA');
    });

    act(() => {
      capturedSummaryActions.current.onPrint!();
    });

    const written = fakeWin._writtenHtml.join('');
    expect(written).toContain('<img');
    expect(written).toContain('data:image/png;base64,REALDATA');
  });

  // #10 — All stops are breaks → canExport false
  it('canExport is false when route has only break stops', async () => {
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stops = [makeStop('b1', 1, { stopType: 'break' })];
    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    render(<Plan />);

    await waitFor(() => {
      expect(capturedSummaryActions.current.canExport).toBeDefined();
    }, { timeout: 3000 });

    expect(capturedSummaryActions.current.canExport).toBe(false);
  });

  // #11 — Warning banner can be shown, dismissed, then shown again on next warning export
  it('warning banner re-appears on a second export with warnings after being dismissed', async () => {
    vi.mocked(settingsService.getSettings).mockResolvedValue({
      depots: [mockDepot],
      breakSettings: null,
      workConstraints: null,
      preferences: null,
    } as unknown as Awaited<ReturnType<typeof settingsService.getSettings>>);

    vi.mocked(routeService.listRoutes).mockResolvedValue(
      { routes: [mockRoute] } as unknown as Awaited<ReturnType<typeof routeService.listRoutes>>,
    );

    const stopsWithNull = [makeStop('s1', 1), makeStop('s2', 2)];
    stopsWithNull[0].customerLat = null as unknown as number;
    stopsWithNull[0].customerLng = null as unknown as number;

    vi.mocked(routeService.getRoute).mockResolvedValue(
      { route: mockRoute, stops: stopsWithNull } as unknown as Awaited<ReturnType<typeof routeService.getRoute>>,
    );
    vi.mocked(listCrews).mockResolvedValue(
      [mockCrew] as unknown as Awaited<ReturnType<typeof listCrews>>,
    );

    render(<Plan />);

    await waitFor(() => {
      expect(capturedSummaryActions.current.onExportGoogleMaps).toBeDefined();
    }, { timeout: 3000 });

    // First export: shows warning banner
    act(() => {
      capturedSummaryActions.current.onExportGoogleMaps!();
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    // Dismiss the banner
    act(() => {
      fireEvent.click(screen.getByRole('status').querySelector('button')!);
    });
    expect(screen.queryByRole('status')).toBeNull();

    // Second export (same null-coord stops): banner should reappear
    act(() => {
      capturedSummaryActions.current.onExportGoogleMaps!();
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
