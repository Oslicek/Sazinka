import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { RouteListPanel } from '../RouteListPanel';
import { usePanelState } from '@/hooks/usePanelState';
import type { SavedRoute } from '@/services/routeService';

vi.mock('@/components/planner', () => ({
  RouteListPanel: ({
    routes,
    selectedRouteId,
    onSelectRoute,
    isLoading,
  }: {
    routes: SavedRoute[];
    selectedRouteId: string | null;
    onSelectRoute: (id: string) => void;
    isLoading: boolean;
  }) => {
    if (isLoading) return <div data-testid="route-loading">Loading</div>;
    if (routes.length === 0) return <div data-testid="route-empty">No routes</div>;
    return (
      <div data-testid="route-list">
        {routes.map((r) => (
          <button
            key={r.id}
            data-testid={`route-${r.id}`}
            data-selected={String(r.id === selectedRouteId)}
            onClick={() => onSelectRoute(r.id)}
          >
            {r.date}
          </button>
        ))}
      </div>
    );
  },
}));

const mockRoute: SavedRoute = {
  id: 'route-1',
  userId: 'user-1',
  crewId: 'crew-1',
  crewName: 'Posádka 1',
  depotId: 'depot-1',
  date: '2026-03-10',
  status: 'planned',
  totalDistanceKm: 120,
  totalDurationMinutes: 180,
  optimizationScore: 0.9,
  arrivalBufferPercent: 0,
  arrivalBufferFixedMinutes: 0,
  returnToDepotDistanceKm: null,
  returnToDepotDurationMinutes: null,
  stopsCount: 5,
  createdAt: '2026-03-10T08:00:00Z',
  updatedAt: '2026-03-10T08:00:00Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <PanelStateProvider>{children}</PanelStateProvider>;
}

describe('RouteListPanel', () => {
  it('renders without crashing when no routes', () => {
    render(<RouteListPanel />, { wrapper });
    expect(screen.getByTestId('route-empty')).toBeInTheDocument();
  });

  it('calls actions.selectRoute when a route is clicked', () => {
    let capturedId: string | null = null;

    function Inspector() {
      const { state } = usePanelState();
      capturedId = state.selectedRouteId;
      return null;
    }

    render(
      <PanelStateProvider>
        <RouteListPanel routes={[mockRoute]} />
        <Inspector />
      </PanelStateProvider>,
    );

    fireEvent.click(screen.getByTestId('route-route-1'));
    expect(capturedId).toBe('route-1');
  });

  it('highlights the selected route from state.selectedRouteId', () => {
    let actionsRef: ReturnType<typeof usePanelState>['actions'] | null = null;

    function Capture() {
      const { actions } = usePanelState();
      actionsRef = actions;
      return null;
    }

    render(
      <PanelStateProvider>
        <Capture />
        <RouteListPanel routes={[mockRoute]} />
      </PanelStateProvider>,
    );

    act(() => {
      actionsRef!.selectRoute('route-1');
    });

    expect(screen.getByTestId('route-route-1')).toHaveAttribute('data-selected', 'true');
  });

  it('renders loading indicator while loading', () => {
    render(<RouteListPanel isLoading={true} />, { wrapper });
    expect(screen.getByTestId('route-loading')).toBeInTheDocument();
  });
});
