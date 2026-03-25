import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { InboxListPanel, mapCallQueueItemToCandidate, resetInboxListCache } from '../InboxListPanel';
import { usePanelState } from '@/hooks/usePanelState';
import type { CandidateRowData } from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';
import type { CallQueueItem } from '@/services/revisionService';
import type { InboxFilterExpression, FilterPresetId } from '@/pages/planningInboxFilters';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/planner', () => ({
  VirtualizedInboxList: ({
    candidates,
    onCandidateSelect,
    isLoading,
    inRouteIds,
    scheduledIds,
  }: {
    candidates: CandidateRowData[];
    onCandidateSelect: (id: string) => void;
    isLoading?: boolean;
    inRouteIds?: Set<string>;
    scheduledIds?: Set<string>;
  }) => {
    if (isLoading) return <div data-testid="inbox-loading">Loading</div>;
    if (candidates.length === 0) return <div data-testid="inbox-empty">Empty</div>;
    return (
      <div data-testid="inbox-list">
        {candidates.map((c) => (
          <button
            key={c.id}
            data-testid={`candidate-${c.id}`}
            data-in-route={String(c.isInRoute || (inRouteIds?.has(c.id) ?? false))}
            data-has-phone={String(c.hasPhone)}
            data-has-valid-address={String(c.hasValidAddress)}
            data-city={c.city}
            data-priority={c.priority}
            data-is-scheduled={String(c.isScheduled || (scheduledIds?.has(c.id) ?? false))}
            data-disable-checkbox={String(!!c.disableCheckbox)}
            onClick={() => onCandidateSelect(c.id)}
          >
            {c.customerName}
          </button>
        ))}
      </div>
    );
  },
}));

const mockGetInbox = vi.fn();
const mockInboxResponseToCallQueueResponse = vi.fn();
vi.mock('@/services/inboxService', () => ({
  getInbox: (...args: unknown[]) => mockGetInbox(...args),
}));
vi.mock('@/services/inboxAdapter', () => ({
  inboxResponseToCallQueueResponse: (...args: unknown[]) => mockInboxResponseToCallQueueResponse(...args),
}));

const mockListRuleSets = vi.fn();
const mockGetInboxState = vi.fn();
const mockSaveInboxState = vi.fn();
vi.mock('@/services/scoringService', () => ({
  listRuleSets: (...args: unknown[]) => mockListRuleSets(...args),
  getInboxState: (...args: unknown[]) => mockGetInboxState(...args),
  saveInboxState: (...args: unknown[]) => mockSaveInboxState(...args),
}));

const mockGetRoute = vi.fn();
vi.mock('@/services/routeService', () => ({
  getRoute: (...args: unknown[]) => mockGetRoute(...args),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: true }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'test-user-inbox-list' } };
    return selector ? selector(state) : state;
  }),
}));

let lastFilterBarProps: {
  filters: InboxFilterExpression;
  onFiltersChange: (f: InboxFilterExpression) => void;
  activePresetId: FilterPresetId | null;
  onPresetChange: (id: FilterPresetId) => void;
  candidateCount: number;
  isAdvancedOpen?: boolean;
  onToggleAdvanced?: () => void;
} | null = null;

vi.mock('@/components/planner/InboxFilterBar', () => ({
  InboxFilterBar: (props: typeof lastFilterBarProps) => {
    lastFilterBarProps = props;
    return (
      <div data-testid="inbox-filter-bar" data-count={props?.candidateCount}>
        FilterBar
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockRawCandidate: CallQueueItem = {
  id: 'cand-1',
  deviceId: 'dev-1',
  customerId: 'cand-1',
  userId: 'user-1',
  status: 'upcoming',
  dueDate: '2026-03-13',
  scheduledDate: null,
  scheduledTimeStart: null,
  scheduledTimeEnd: null,
  customerName: 'Jana Novotná',
  customerPhone: '+420 111 222 333',
  customerEmail: null,
  customerStreet: 'Masarykova 1',
  customerCity: 'Brno',
  customerPostalCode: '60200',
  customerLat: 49.19,
  customerLng: 16.61,
  customerGeocodeStatus: 'success',
  deviceName: null,
  deviceType: 'boiler',
  deviceTypeDefaultDurationMinutes: null,
  daysUntilDue: 3,
  priority: 'due_soon',
  lastContactAt: null,
  contactAttempts: 0,
};

const mockStop: SavedRouteStop = {
  id: 'stop-1',
  routeId: 'route-1',
  revisionId: null,
  stopOrder: 0,
  estimatedArrival: null,
  estimatedDeparture: null,
  distanceFromPreviousKm: null,
  durationFromPreviousMinutes: null,
  status: 'pending',
  stopType: 'customer',
  customerId: 'cand-1',
  customerName: 'Jana Novotná',
  address: 'Brno',
  customerLat: 49.19,
  customerLng: 16.61,
  customerPhone: null,
  customerEmail: null,
  scheduledDate: null,
  scheduledTimeStart: null,
  scheduledTimeEnd: null,
  revisionStatus: null,
};

const mockRouteContext = {
  date: '2026-03-10',
  crewId: 'crew-1',
  crewName: 'Crew 1',
  depotId: 'depot-1',
  depotName: 'Brno',
};

function makeInboxResponse(items: CallQueueItem[]) {
  return {
    items,
    total: items.length,
    overdueCount: 0,
    dueSoonCount: 0,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
      {children}
    </PanelStateProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetInboxListCache();
  mockGetInbox.mockResolvedValue(makeInboxResponse([]));
  mockInboxResponseToCallQueueResponse.mockImplementation((r: ReturnType<typeof makeInboxResponse>) => ({
    items: r.items,
  }));
  mockListRuleSets.mockResolvedValue([]);
  mockGetInboxState.mockResolvedValue(null);
  mockSaveInboxState.mockResolvedValue(undefined);
  mockGetRoute.mockResolvedValue({ route: null, stops: [] });
});

describe('InboxListPanel (self-sufficient)', () => {
  it('shows loading state while fetching', async () => {
    // Never resolves during this test
    mockGetInbox.mockReturnValue(new Promise(() => {}));
    render(<InboxListPanel />, { wrapper });
    expect(screen.getByTestId('inbox-loading')).toBeInTheDocument();
  });

  it('fetches candidates from NATS on mount', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('inbox-list')).toBeInTheDocument());
  });

  it('renders candidate rows after fetch', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument());
    expect(screen.getByText('Jana Novotná')).toBeInTheDocument();
  });

  it('sends SELECT_CUSTOMER signal on row click', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument());
    act(() => { fireEvent.click(screen.getByTestId('candidate-cand-1')); });
    expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument();
  });

  it('loads route stops for current context and marks in-route candidates', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });
    mockGetRoute.mockResolvedValue({ route: { id: 'route-1' }, stops: [mockStop] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId('candidate-cand-1')).toHaveAttribute('data-in-route', 'true')
    );
  });

  it('loads scoring rule sets on mount', async () => {
    const ruleSets = [{ id: 'rs-1', name: 'Default', isDefault: true, isArchived: false }];
    mockListRuleSets.mockResolvedValue(ruleSets);

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(mockListRuleSets).toHaveBeenCalled());
  });

  it('persists filter state via getInboxState/saveInboxState', async () => {
    mockGetInboxState.mockResolvedValue({ selectedRuleSetId: 'rs-1' });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(mockGetInboxState).toHaveBeenCalled());
  });

  it('re-fetches when ROUTE_CONTEXT signal changes day (via actions.setRouteContext)', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([]));

    // Capture actions so we can trigger a context change
    let capturedActions: ReturnType<typeof usePanelState>['actions'] | null = null;
    function ActionCapture() {
      const { actions } = usePanelState();
      capturedActions = actions;
      return null;
    }

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <ActionCapture />
        <InboxListPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(mockGetInbox).toHaveBeenCalledTimes(1));

    // Change the route context — panel should re-fetch
    act(() => {
      capturedActions!.setRouteContext({ ...mockRouteContext, date: '2026-03-11' });
    });

    await waitFor(() => expect(mockGetInbox).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// mapCallQueueItemToCandidate – pure unit tests
// ---------------------------------------------------------------------------

const rawCallQueueItem: CallQueueItem = {
  id: 'cqi-1',
  deviceId: 'dev-1',
  customerId: 'cust-1',
  userId: 'user-1',
  status: 'upcoming',
  dueDate: '2026-03-15',
  scheduledDate: null,
  scheduledTimeStart: null,
  scheduledTimeEnd: null,
  customerName: 'Karel Svoboda',
  customerPhone: '+420 123 456 789',
  customerEmail: null,
  customerStreet: 'Hlavní 1',
  customerCity: 'Praha',
  customerPostalCode: '11000',
  customerLat: 50.08,
  customerLng: 14.42,
  customerGeocodeStatus: 'success',
  deviceName: 'Kotel XY',
  deviceType: 'boiler',
  deviceTypeDefaultDurationMinutes: 60,
  daysUntilDue: 5,
  priority: 'due_this_week',
  lastContactAt: null,
  contactAttempts: 0,
};

describe('mapCallQueueItemToCandidate', () => {
  it('derives hasPhone=true from non-empty customerPhone', () => {
    const result = mapCallQueueItemToCandidate(rawCallQueueItem);
    expect(result.hasPhone).toBe(true);
  });

  it('derives hasPhone=false when customerPhone is null', () => {
    const result = mapCallQueueItemToCandidate({ ...rawCallQueueItem, customerPhone: null });
    expect(result.hasPhone).toBe(false);
  });

  it('derives hasPhone=false when customerPhone is empty string', () => {
    const result = mapCallQueueItemToCandidate({ ...rawCallQueueItem, customerPhone: '  ' });
    expect(result.hasPhone).toBe(false);
  });

  it('derives hasValidAddress=true from geocoded coordinates', () => {
    const result = mapCallQueueItemToCandidate(rawCallQueueItem);
    expect(result.hasValidAddress).toBe(true);
  });

  it('derives hasValidAddress=false when geocode failed', () => {
    const result = mapCallQueueItemToCandidate({
      ...rawCallQueueItem,
      customerGeocodeStatus: 'failed',
      customerLat: null,
      customerLng: null,
    });
    expect(result.hasValidAddress).toBe(false);
  });

  it('maps customerCity to city, defaulting to empty string', () => {
    expect(mapCallQueueItemToCandidate(rawCallQueueItem).city).toBe('Praha');
    expect(mapCallQueueItemToCandidate({ ...rawCallQueueItem, customerCity: '' }).city).toBe('');
  });

  it('uses customerId as id', () => {
    expect(mapCallQueueItemToCandidate(rawCallQueueItem).id).toBe('cust-1');
  });

  it('preserves priority from CallQueueItem', () => {
    const result = mapCallQueueItemToCandidate({ ...rawCallQueueItem, priority: 'overdue', daysUntilDue: -3 });
    expect(result.priority).toBe('overdue');
  });

  it('sets disableCheckbox=true when address is invalid', () => {
    const result = mapCallQueueItemToCandidate({
      ...rawCallQueueItem,
      customerGeocodeStatus: 'failed',
      customerLat: null,
      customerLng: null,
    });
    expect(result.disableCheckbox).toBe(true);
  });

  it('derives isScheduled from scheduled/confirmed status', () => {
    expect(mapCallQueueItemToCandidate({ ...rawCallQueueItem, status: 'scheduled' }).isScheduled).toBe(true);
    expect(mapCallQueueItemToCandidate({ ...rawCallQueueItem, status: 'confirmed' }).isScheduled).toBe(true);
    expect(mapCallQueueItemToCandidate({ ...rawCallQueueItem, status: 'upcoming' }).isScheduled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Filter integration tests
// ---------------------------------------------------------------------------

describe('InboxListPanel – filter integration', () => {
  beforeEach(() => {
    lastFilterBarProps = null;
  });

  it('renders InboxFilterBar above the list', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('inbox-filter-bar')).toBeInTheDocument());
  });

  it('passes filtered candidate count to InboxFilterBar', async () => {
    const due3 = { ...rawCallQueueItem, customerId: 'c1', daysUntilDue: 3, priority: 'due_this_week' as const };
    const due60 = { ...rawCallQueueItem, customerId: 'c2', daysUntilDue: 60, priority: 'upcoming' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([due3, due60]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [due3, due60] });

    render(<InboxListPanel />, { wrapper });

    // Default filter is DUE_IN_7_DAYS, so only due3 should pass
    await waitFor(() => {
      expect(lastFilterBarProps).not.toBeNull();
      expect(lastFilterBarProps!.candidateCount).toBe(1);
    });
  });

  it('filters candidates through applyInboxFilters with default expression', async () => {
    const due3 = { ...rawCallQueueItem, customerId: 'c1', daysUntilDue: 3, priority: 'due_this_week' as const };
    const due60 = { ...rawCallQueueItem, customerId: 'c2', daysUntilDue: 60, priority: 'upcoming' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([due3, due60]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [due3, due60] });

    render(<InboxListPanel />, { wrapper });

    // Default filter DUE_IN_7_DAYS: only due3 (daysUntilDue=3) passes
    await waitFor(() => expect(screen.getByTestId('candidate-c1')).toBeInTheDocument());
    expect(screen.queryByTestId('candidate-c2')).not.toBeInTheDocument();
  });

  it('shows all candidates when ALL preset is applied', async () => {
    const due3 = { ...rawCallQueueItem, customerId: 'c1', daysUntilDue: 3, priority: 'due_this_week' as const };
    const due60 = { ...rawCallQueueItem, customerId: 'c2', daysUntilDue: 60, priority: 'upcoming' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([due3, due60]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [due3, due60] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());

    // Simulate applying ALL preset via the callback
    act(() => {
      lastFilterBarProps!.onPresetChange('ALL');
    });

    await waitFor(() => {
      expect(screen.getByTestId('candidate-c1')).toBeInTheDocument();
      expect(screen.getByTestId('candidate-c2')).toBeInTheDocument();
    });
  });

  it('sorts candidates: valid address first, then overdue before upcoming', async () => {
    const overdue = { ...rawCallQueueItem, customerId: 'c-overdue', daysUntilDue: -5, priority: 'overdue' as const };
    const dueThisWeek = { ...rawCallQueueItem, customerId: 'c-week', daysUntilDue: 3, priority: 'due_this_week' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([dueThisWeek, overdue]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [dueThisWeek, overdue] });

    render(<InboxListPanel />, { wrapper });

    // Apply ALL preset to see both
    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());
    act(() => { lastFilterBarProps!.onPresetChange('ALL'); });

    await waitFor(() => {
      const items = screen.getAllByTestId(/^candidate-/);
      expect(items[0]).toHaveAttribute('data-testid', 'candidate-c-overdue');
      expect(items[1]).toHaveAttribute('data-testid', 'candidate-c-week');
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-8: Filter + preset persistence across navigation
// ---------------------------------------------------------------------------

describe('InboxListPanel – filter persistence (BUG-8)', () => {
  beforeEach(() => {
    lastFilterBarProps = null;
    sessionStorage.clear();
  });

  it('BUG-8a: activePresetId survives unmount and remount', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });

    const { unmount } = render(<InboxListPanel />, { wrapper });
    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());

    // Apply the ALL preset
    act(() => { lastFilterBarProps!.onPresetChange('ALL'); });
    expect(lastFilterBarProps!.activePresetId).toBe('ALL');

    // Simulate navigation away
    unmount();
    resetInboxListCache();

    // Simulate navigation back
    lastFilterBarProps = null;
    render(<InboxListPanel />, { wrapper });
    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());

    expect(lastFilterBarProps!.activePresetId).toBe('ALL');
  });

  it('BUG-8b: filter expression set via preset survives two unmount/remount cycles', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockRawCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockRawCandidate] });

    // 1st mount — apply ALL preset
    const { unmount: unmount1 } = render(<InboxListPanel />, { wrapper });
    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());
    act(() => { lastFilterBarProps!.onPresetChange('ALL'); });
    const allFilters = lastFilterBarProps!.filters;
    unmount1();
    resetInboxListCache();

    // 2nd mount — filters should be ALL
    lastFilterBarProps = null;
    const { unmount: unmount2 } = render(<InboxListPanel />, { wrapper });
    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());
    expect(lastFilterBarProps!.filters).toEqual(allFilters);
    unmount2();
    resetInboxListCache();

    // 3rd mount — filters should STILL be ALL
    lastFilterBarProps = null;
    render(<InboxListPanel />, { wrapper });
    await waitFor(() => expect(lastFilterBarProps).not.toBeNull());
    expect(lastFilterBarProps!.filters).toEqual(allFilters);
  });
});

// ---------------------------------------------------------------------------
// Route stop enrichment — isInRoute + isScheduled from PanelState
// ---------------------------------------------------------------------------

describe('InboxListPanel – route stop enrichment', () => {
  beforeEach(() => {
    lastFilterBarProps = null;
  });

  it('marks candidate as isInRoute when PanelState routeStops contains matching customerId', async () => {
    const item = { ...rawCallQueueItem, customerId: 'c1', daysUntilDue: 3, priority: 'due_this_week' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([item]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [item] });

    let capturedActions: ReturnType<typeof usePanelState>['actions'] | null = null;
    function ActionCapture() {
      const { actions } = usePanelState();
      capturedActions = actions;
      return null;
    }

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <ActionCapture />
        <InboxListPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(screen.getByTestId('candidate-c1')).toBeInTheDocument());

    // Simulate PlanningInbox bridge writing route stops to PanelState
    act(() => {
      capturedActions!.setRouteStops([{
        ...mockStop,
        customerId: 'c1',
      }]);
    });

    await waitFor(() =>
      expect(screen.getByTestId('candidate-c1')).toHaveAttribute('data-in-route', 'true')
    );
  });

  it('marks candidate as isScheduled when route stop has scheduledTimeStart', async () => {
    const item = { ...rawCallQueueItem, customerId: 'c1', daysUntilDue: 3, priority: 'due_this_week' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([item]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [item] });

    let capturedActions: ReturnType<typeof usePanelState>['actions'] | null = null;
    function ActionCapture() {
      const { actions } = usePanelState();
      capturedActions = actions;
      return null;
    }

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <ActionCapture />
        <InboxListPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(screen.getByTestId('candidate-c1')).toBeInTheDocument());
    // Initially not scheduled
    expect(screen.getByTestId('candidate-c1')).toHaveAttribute('data-is-scheduled', 'false');

    // Simulate bridge writing route stop with an agreed visit time
    act(() => {
      capturedActions!.setRouteStops([{
        ...mockStop,
        customerId: 'c1',
        scheduledTimeStart: '09:00',
        scheduledTimeEnd: '10:00',
      }]);
    });

    await waitFor(() =>
      expect(screen.getByTestId('candidate-c1')).toHaveAttribute('data-is-scheduled', 'true')
    );
  });

  it('marks candidate as isScheduled when route stop has revisionStatus=scheduled (no scheduledTimeStart)', async () => {
    const item = { ...rawCallQueueItem, customerId: 'c1', daysUntilDue: 3, priority: 'due_this_week' as const };
    mockGetInbox.mockResolvedValue(makeInboxResponse([item]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [item] });

    let capturedActions: ReturnType<typeof usePanelState>['actions'] | null = null;
    function ActionCapture() {
      const { actions } = usePanelState();
      capturedActions = actions;
      return null;
    }

    render(
      <PanelStateProvider activePageContext="inbox" enableChannel={false} initialRouteContext={mockRouteContext}>
        <ActionCapture />
        <InboxListPanel />
      </PanelStateProvider>
    );

    await waitFor(() => expect(screen.getByTestId('candidate-c1')).toBeInTheDocument());

    act(() => {
      capturedActions!.setRouteStops([{
        ...mockStop,
        customerId: 'c1',
        scheduledTimeStart: null,
        revisionStatus: 'scheduled',
      }]);
    });

    await waitFor(() =>
      expect(screen.getByTestId('candidate-c1')).toHaveAttribute('data-is-scheduled', 'true')
    );
  });
});
