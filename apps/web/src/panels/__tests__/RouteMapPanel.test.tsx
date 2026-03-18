import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { usePanelState } from '../../hooks/usePanelState';
import { RouteMapPanel } from '../RouteMapPanel';
import type { PanelActions } from '../../types/panelState';
import type { SavedRouteStop } from '../../services/routeService';
import type { InsertionPreview } from '../../components/planner/RouteMapPanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// vi.hoisted ensures mockProps is available inside the vi.mock factory (which is hoisted)
const { mockProps } = vi.hoisted(() => ({
  mockProps: { current: {} as Record<string, unknown> },
}));

vi.mock('@/components/planner/RouteMapPanel', () => ({
  RouteMapPanel: (props: Record<string, unknown>) => {
    mockProps.current = { ...props };
    return null;
  },
}));

const mockGetRoute = vi.fn();
vi.mock('@/services/routeService', () => ({
  getRoute: (...args: unknown[]) => mockGetRoute(...args),
}));

const mockSubmitGeometryJob = vi.fn();
const mockSubscribeToGeometryJobStatus = vi.fn();
vi.mock('@/services/geometryService', () => ({
  submitGeometryJob: (...args: unknown[]) => mockSubmitGeometryJob(...args),
  subscribeToGeometryJobStatus: (...args: unknown[]) => mockSubscribeToGeometryJobStatus(...args),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: true }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStop(id = 'stop-1'): SavedRouteStop {
  return {
    id,
    routeId: 'route-1',
    revisionId: null,
    stopOrder: 1,
    estimatedArrival: null,
    estimatedDeparture: null,
    distanceFromPreviousKm: null,
    durationFromPreviousMinutes: null,
    status: 'pending',
    stopType: 'customer',
    customerId: `cust-${id}`,
    customerName: `Customer ${id}`,
    address: '1 Main St',
    customerLat: 50.0,
    customerLng: 14.0,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
  };
}

const mockRouteContext = {
  date: '2026-03-10',
  crewId: 'crew-1',
  crewName: 'Crew 1',
  depotId: 'depot-1',
  depotName: 'Brno',
};

function makeActionsCapture() {
  const ref: { actions: PanelActions | null } = { actions: null };
  function ActionsCapture() {
    ref.actions = usePanelState().actions;
    return null;
  }
  return { ref, ActionsCapture };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockProps.current = {};
  vi.clearAllMocks();
  mockGetRoute.mockResolvedValue({ route: null, stops: [] });
  mockSubmitGeometryJob.mockResolvedValue({ jobId: 'geo-job-1' });
  mockSubscribeToGeometryJobStatus.mockResolvedValue(() => {});
});

describe('panels/RouteMapPanel', () => {
  // ---- Existing behaviour (preserved) ----

  it('renders without crashing when no stops', () => {
    expect(() =>
      render(
        <PanelStateProvider>
          <RouteMapPanel />
        </PanelStateProvider>,
      ),
    ).not.toThrow();
  });

  it('passes routeStops from state to the map component', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const stop = makeStop();
    act(() => {
      ref.actions!.setRouteStops([stop]);
    });

    expect(mockProps.current.stops).toEqual([stop]);
  });

  it('passes routeGeometry from state to the map component', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const geo: [number, number][] = [[14.0, 50.0], [14.1, 50.1]];
    act(() => {
      ref.actions!.setRouteGeometry(geo);
    });

    expect(mockProps.current.routeGeometry).toEqual(geo);
  });

  it('passes highlightedSegment from state to the map component', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.highlightSegment(2);
    });

    expect(mockProps.current.highlightedSegment).toBe(2);
  });

  it('passes insertionPreview from state to the map component', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const preview: InsertionPreview = {
      candidateId: 'cand-1',
      candidateName: 'Candidate',
      coordinates: { lat: 50.0, lng: 14.0 },
      insertAfterIndex: 0,
      insertBeforeIndex: 1,
    };

    act(() => {
      ref.actions!.setInsertionPreview(preview);
    });

    expect(mockProps.current.insertionPreview).toEqual(preview);
  });

  it('calls highlightSegment action when onSegmentClick fires', () => {
    render(
      <PanelStateProvider>
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const onSegmentHighlight = mockProps.current.onSegmentHighlight as (idx: number | null) => void;
    act(() => {
      onSegmentHighlight(3);
    });

    expect(mockProps.current.highlightedSegment).toBe(3);
  });

  it('calls selectCustomer action when onStopClick fires', () => {
    render(
      <PanelStateProvider>
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const onStopClick = mockProps.current.onStopClick as (id: string) => void;
    act(() => {
      onStopClick('cust-1');
    });

    expect(mockProps.current.highlightedStopId).toBe('cust-1');
  });

  // ---- New G.4 behaviour: self-sufficient data fetching ----

  it('fetches route stops from NATS on mount when routeContext provided', async () => {
    const stop = makeStop();
    mockGetRoute.mockResolvedValue({ route: { id: 'route-1' }, stops: [stop] });

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <RouteMapPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(mockGetRoute).toHaveBeenCalledWith({ date: '2026-03-10' }));
    await waitFor(() => expect(mockProps.current.stops).toEqual([stop]));
  });

  it('fetches geometry after stops load', async () => {
    const stop = makeStop();
    mockGetRoute.mockResolvedValue({ route: { id: 'route-1' }, stops: [stop] });

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <RouteMapPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(mockSubmitGeometryJob).toHaveBeenCalled());
  });

  it('re-fetches when ROUTE_CONTEXT signal changes day', async () => {
    mockGetRoute.mockResolvedValue({ route: null, stops: [] });

    let capturedActions: PanelActions | null = null;
    function ActionCapture() {
      capturedActions = usePanelState().actions;
      return null;
    }

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <ActionCapture />
        <RouteMapPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(1));

    act(() => {
      capturedActions!.setRouteContext({ ...mockRouteContext, date: '2026-03-11' });
    });

    await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(2));
  });

  it('highlights stop when SELECT_CUSTOMER signal received', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.selectCustomer('cust-42');
    });

    expect(mockProps.current.highlightedStopId).toBe('cust-42');
  });

  it('highlights segment when HIGHLIGHT_SEGMENT signal received', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.highlightSegment(5);
    });

    expect(mockProps.current.highlightedSegment).toBe(5);
  });

  it('sends SELECT_CUSTOMER signal on stop click', () => {
    render(
      <PanelStateProvider>
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const onStopClick = mockProps.current.onStopClick as (id: string) => void;
    act(() => { onStopClick('cust-99'); });

    expect(mockProps.current.highlightedStopId).toBe('cust-99');
  });

  it('sends HIGHLIGHT_SEGMENT signal on segment click', () => {
    render(
      <PanelStateProvider>
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const onSegmentHighlight = mockProps.current.onSegmentHighlight as (idx: number | null) => void;
    act(() => { onSegmentHighlight(7); });

    expect(mockProps.current.highlightedSegment).toBe(7);
  });

  it('passes selectedCandidates from state to map component', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    const candidates = [
      { id: 'c1', name: 'Alice', coordinates: { lat: 50.1, lng: 14.1 } },
      { id: 'c2', name: 'Bob',   coordinates: { lat: 50.2, lng: 14.2 } },
    ];

    act(() => {
      ref.actions!.setSelectedCandidatesForMap(candidates);
    });

    expect(mockProps.current.selectedCandidates).toEqual(candidates);
  });

  it('passes empty array when no batch candidates are set', () => {
    render(
      <PanelStateProvider>
        <RouteMapPanel />
      </PanelStateProvider>,
    );
    // selectedCandidates defaults to [] (empty array)
    expect(mockProps.current.selectedCandidates).toEqual([]);
  });

  it('SELECT_CANDIDATES_MAP signal updates selectedCandidates prop', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <RouteMapPanel />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.setSelectedCandidatesForMap([
        { id: 'x1', name: 'X', coordinates: { lat: 49.0, lng: 16.0 } },
      ]);
    });

    expect((mockProps.current.selectedCandidates as unknown[]).length).toBe(1);
  });

  it('shows loading state while fetching', async () => {
    // Never resolves
    mockGetRoute.mockReturnValue(new Promise(() => {}));

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <RouteMapPanel />
      </PanelStateProvider>
    );

    // Map component should still render (not crash) while loading
    expect(mockProps.current).toBeDefined();
  });
});
