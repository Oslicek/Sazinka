import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { InboxListPanel } from '../InboxListPanel';
import { usePanelState } from '@/hooks/usePanelState';
import type { CandidateRowData } from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';

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

function wrapper({ children }: { children: React.ReactNode }) {
  return <PanelStateProvider>{children}</PanelStateProvider>;
}

describe('InboxListPanel', () => {
  it('renders empty state when no candidates', () => {
    render(<InboxListPanel />, { wrapper });
    expect(screen.getByTestId('inbox-empty')).toBeInTheDocument();
  });

  it('calls actions.selectCustomer when candidate row is clicked', () => {
    let capturedId: string | null = null;

    function Inspector() {
      const { state } = usePanelState();
      capturedId = state.selectedCustomerId;
      return null;
    }

    render(
      <PanelStateProvider>
        <InboxListPanel candidates={[mockCandidate]} />
        <Inspector />
      </PanelStateProvider>,
    );

    fireEvent.click(screen.getByTestId('candidate-cand-1'));
    expect(capturedId).toBe('cand-1');
  });

  it('marks in-route candidates with inRouteIds derived from routeStops', () => {
    let actionsRef: ReturnType<typeof usePanelState>['actions'] | null = null;

    function Capture() {
      const { actions } = usePanelState();
      actionsRef = actions;
      return null;
    }

    render(
      <PanelStateProvider>
        <Capture />
        <InboxListPanel candidates={[mockCandidate]} />
      </PanelStateProvider>,
    );

    act(() => {
      actionsRef!.setRouteStops([mockStop]);
    });

    expect(screen.getByTestId('candidate-cand-1')).toHaveAttribute('data-in-route', 'true');
  });

  it('renders loading state while candidates are loading', () => {
    render(<InboxListPanel isLoading={true} />, { wrapper });
    expect(screen.getByTestId('inbox-loading')).toBeInTheDocument();
  });
});
