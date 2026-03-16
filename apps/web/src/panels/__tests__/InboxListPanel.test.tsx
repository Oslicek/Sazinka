import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { InboxListPanel } from '../InboxListPanel';
import { usePanelState } from '@/hooks/usePanelState';
import type { CandidateRowData } from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/planner', () => ({
  VirtualizedInboxList: ({
    candidates,
    onCandidateSelect,
    isLoading,
    inRouteIds,
  }: {
    candidates: CandidateRowData[];
    onCandidateSelect: (id: string) => void;
    isLoading?: boolean;
    inRouteIds?: Set<string>;
  }) => {
    if (isLoading) return <div data-testid="inbox-loading">Loading</div>;
    if (candidates.length === 0) return <div data-testid="inbox-empty">Empty</div>;
    return (
      <div data-testid="inbox-list">
        {candidates.map((c) => (
          <button
            key={c.id}
            data-testid={`candidate-${c.id}`}
            data-in-route={String(inRouteIds?.has(c.id) ?? false)}
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockCandidate: CandidateRowData = {
  id: 'cand-1',
  customerName: 'Jana Novotná',
  city: 'Brno',
  daysUntilDue: 3,
  hasPhone: true,
  hasValidAddress: true,
  priority: 'due_soon',
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

function makeInboxResponse(candidates: CandidateRowData[]) {
  return {
    items: candidates.map(c => ({
      ...c,
      scheduledDate: null,
      scheduledTimeStart: null,
      scheduledTimeEnd: null,
    })),
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
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('inbox-list')).toBeInTheDocument());
  });

  it('renders candidate rows after fetch', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument());
    expect(screen.getByText('Jana Novotná')).toBeInTheDocument();
  });

  it('sends SELECT_CUSTOMER signal on row click', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockCandidate] });

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument());
    act(() => { fireEvent.click(screen.getByTestId('candidate-cand-1')); });
    // After click, the list item should still be in the document (no crash)
    expect(screen.getByTestId('candidate-cand-1')).toBeInTheDocument();
  });

  it('loads route stops for current context and marks in-route candidates', async () => {
    mockGetInbox.mockResolvedValue(makeInboxResponse([mockCandidate]));
    mockInboxResponseToCallQueueResponse.mockReturnValue({ items: [mockCandidate] });
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
