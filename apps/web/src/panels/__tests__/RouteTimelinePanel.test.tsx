import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PanelStateContext } from '../../contexts/PanelStateContext';
import type { PanelStateContextValue, PanelState, PanelActions } from '../../types/panelState';
import { RouteTimelinePanel } from '../RouteTimelinePanel';
import type { SavedRouteStop } from '../../services/routeService';

vi.mock('@/components/planner', () => ({
  RouteDetailTimeline: ({
    stops,
    onStopClick,
    onReorder,
  }: {
    stops: SavedRouteStop[];
    onStopClick: (id: string, idx: number) => void;
    onReorder?: (stops: SavedRouteStop[]) => void;
  }) => (
    <div data-testid="route-detail-timeline">
      <span data-testid="stop-count">{stops.length} stops</span>
      {stops.map((s, i) => (
        <button key={s.id} onClick={() => onStopClick(s.customerId ?? '', i)} data-testid={`stop-${s.id}`}>
          {s.customerName}
        </button>
      ))}
      {onReorder && (
        <button onClick={() => onReorder([...stops].reverse())} data-testid="reorder-btn">
          Reorder
        </button>
      )}
    </div>
  ),
  PlanningTimeline: ({ stops }: { stops: SavedRouteStop[] }) => (
    <div data-testid="planning-timeline">{stops.length} planning stops</div>
  ),
  TimelineViewToggle: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: 'compact' | 'planning') => void;
  }) => (
    <div data-testid="timeline-view-toggle">
      <button
        onClick={() => onChange(value === 'compact' ? 'planning' : 'compact')}
        data-testid="toggle-btn"
      >
        {value}
      </button>
    </div>
  ),
  RouteSummaryStats: ({
    metrics,
    stopCount,
  }: {
    metrics: unknown;
    stopCount: number;
  }) => (
    <div data-testid="route-summary-stats">
      <span data-testid="stats-stop-count">{stopCount}</span>
      <span data-testid="stats-metrics">{metrics ? 'has metrics' : 'no metrics'}</span>
    </div>
  ),
  RouteSummaryActions: ({
    onOptimize,
    onAddBreak,
  }: {
    onOptimize?: () => void;
    onAddBreak?: () => void;
  }) => (
    <div data-testid="route-summary-actions">
      {onOptimize && (
        <button onClick={onOptimize} data-testid="optimize-btn">
          Optimize
        </button>
      )}
      {onAddBreak && (
        <button onClick={onAddBreak} data-testid="add-break-btn">
          Add Break
        </button>
      )}
    </div>
  ),
  ArrivalBufferBar: ({
    percent,
    fixedMinutes,
    onChange,
  }: {
    percent: number;
    fixedMinutes: number;
    onChange: (pct: number, fixed: number) => void;
  }) => (
    <div data-testid="arrival-buffer-bar">
      <button onClick={() => onChange(10, 5)} data-testid="buffer-change-btn">
        {percent}% + {fixedMinutes}min
      </button>
    </div>
  ),
}));

function buildMockState(overrides?: Partial<PanelState>): PanelState {
  return {
    selectedCustomerId: null,
    selectedRouteId: null,
    routeContext: null,
    routeStops: [],
    highlightedSegment: null,
    insertionPreview: null,
    activePageContext: 'inbox',
    routeGeometry: [],
    returnToDepotLeg: null,
    depotDeparture: null,
    routeWarnings: [],
    breakWarnings: [],
    metrics: null,
    routeBufferPercent: 0,
    routeBufferFixedMinutes: 0,
    ...overrides,
  };
}

function buildMockActions(overrides?: Partial<PanelActions>): PanelActions {
  return {
    selectCustomer: vi.fn(),
    selectRoute: vi.fn(),
    setRouteContext: vi.fn(),
    setRouteStops: vi.fn(),
    highlightSegment: vi.fn(),
    setInsertionPreview: vi.fn(),
    setRouteGeometry: vi.fn(),
    setReturnToDepotLeg: vi.fn(),
    setDepotDeparture: vi.fn(),
    setRouteWarnings: vi.fn(),
    setBreakWarnings: vi.fn(),
    setMetrics: vi.fn(),
    setRouteBuffer: vi.fn(),
    ...overrides,
  };
}

function renderPanel(
  stateOverrides?: Partial<PanelState>,
  actionOverrides?: Partial<PanelActions>,
  props?: { onOptimize?: () => void },
) {
  const mockState = buildMockState(stateOverrides);
  const mockActions = buildMockActions(actionOverrides);
  const contextValue: PanelStateContextValue = { state: mockState, actions: mockActions };

  const result = render(
    <PanelStateContext.Provider value={contextValue}>
      <RouteTimelinePanel {...props} />
    </PanelStateContext.Provider>,
  );

  return { ...result, mockActions };
}

function makeStop(id: string): SavedRouteStop {
  return {
    id,
    routeId: 'route-1',
    revisionId: null,
    stopOrder: 0,
    customerId: `cust-${id}`,
    customerName: `Customer ${id}`,
    address: '1 Main St',
    customerLat: 50.0,
    customerLng: 14.0,
    customerPhone: null,
    customerEmail: null,
    status: 'assigned',
    revisionStatus: null,
    estimatedArrival: null,
    estimatedDeparture: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    serviceDurationMinutes: 30,
    overrideServiceDurationMinutes: null,
    durationFromPreviousMinutes: null,
    distanceFromPreviousKm: null,
    overrideTravelDurationMinutes: null,
    stopType: 'customer',
    breakTimeStart: null,
    breakDurationMinutes: null,
  };
}

describe('RouteTimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when no stops', () => {
    renderPanel();
    expect(screen.getByTestId('route-detail-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('route-summary-stats')).toBeInTheDocument();
  });

  it('renders break warnings when provided', () => {
    renderPanel({ breakWarnings: ['Break too short', 'Missing break'] });
    expect(screen.getByText('Break too short')).toBeInTheDocument();
    expect(screen.getByText('Missing break')).toBeInTheDocument();
  });

  it('passes routeStops from state to timeline component', () => {
    const stops = [makeStop('a'), makeStop('b'), makeStop('c')];
    renderPanel({ routeStops: stops });
    expect(screen.getByTestId('stop-count')).toHaveTextContent('3 stops');
  });

  it('passes metrics from state to stats component', () => {
    const metrics = { travelTimeMin: 60, serviceTimeMin: 30, distanceKm: 40, loadPercent: 80, slackMin: 15, stopCount: 3 };
    renderPanel({ metrics });
    expect(screen.getByTestId('stats-metrics')).toHaveTextContent('has metrics');
  });

  it('calls highlightSegment when a stop is clicked', () => {
    const stops = [makeStop('x')];
    const { mockActions } = renderPanel({ routeStops: stops });
    fireEvent.click(screen.getByTestId('stop-x'));
    expect(mockActions.highlightSegment).toHaveBeenCalledWith(0);
  });

  it('calls setRouteStops after reorder', () => {
    const stops = [makeStop('1'), makeStop('2')];
    const { mockActions } = renderPanel({ routeStops: stops });
    fireEvent.click(screen.getByTestId('reorder-btn'));
    expect(mockActions.setRouteStops).toHaveBeenCalledOnce();
    const reordered = (mockActions.setRouteStops as ReturnType<typeof vi.fn>).mock.calls[0][0] as SavedRouteStop[];
    expect(reordered[0].id).toBe('2');
    expect(reordered[1].id).toBe('1');
  });

  it('toggles between compact and planning view', () => {
    renderPanel();
    expect(screen.getByTestId('route-detail-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('planning-timeline')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle-btn'));
    expect(screen.getByTestId('planning-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('route-detail-timeline')).not.toBeInTheDocument();
  });

  it('calls setRouteBuffer on buffer change', () => {
    const { mockActions } = renderPanel({ routeBufferPercent: 5, routeBufferFixedMinutes: 2 });
    fireEvent.click(screen.getByTestId('buffer-change-btn'));
    expect(mockActions.setRouteBuffer).toHaveBeenCalledWith(10, 5);
  });
});
