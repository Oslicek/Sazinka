import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../PanelStateContext';
import { usePanelState } from '../../hooks/usePanelState';
import type { RouteContext } from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';

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
  customerId: 'cust-1',
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

const mockContext: RouteContext = {
  date: '2026-03-10',
  crewId: 'crew-1',
  crewName: 'Posádka 1',
  depotId: 'depot-1',
  depotName: 'Brno',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <PanelStateProvider>{children}</PanelStateProvider>;
}

describe('PanelStateProvider', () => {
  it('provides default state to children', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    expect(result.current.state.selectedCustomerId).toBeNull();
    expect(result.current.state.selectedRouteId).toBeNull();
    expect(result.current.state.routeContext).toBeNull();
    expect(result.current.state.routeStops).toEqual([]);
    expect(result.current.state.highlightedSegment).toBeNull();
    expect(result.current.state.insertionPreview).toBeNull();
    expect(result.current.state.routeGeometry).toEqual([]);
    expect(result.current.state.returnToDepotLeg).toBeNull();
    expect(result.current.state.depotDeparture).toBeNull();
    expect(result.current.state.routeWarnings).toEqual([]);
    expect(result.current.state.breakWarnings).toEqual([]);
    expect(result.current.state.metrics).toBeNull();
    expect(result.current.state.routeBufferPercent).toBe(0);
    expect(result.current.state.routeBufferFixedMinutes).toBe(0);
    expect(result.current.state.activePageContext).toBe('inbox');
  });

  it('allows selecting a customer', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.selectCustomer('cust-42');
    });

    expect(result.current.state.selectedCustomerId).toBe('cust-42');
  });

  it('allows clearing customer selection', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.selectCustomer('cust-42');
    });
    act(() => {
      result.current.actions.selectCustomer(null);
    });

    expect(result.current.state.selectedCustomerId).toBeNull();
  });

  it('allows selecting a route', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.selectRoute('route-99');
    });

    expect(result.current.state.selectedRouteId).toBe('route-99');
  });

  it('allows setting route context', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setRouteContext(mockContext);
    });

    expect(result.current.state.routeContext).toEqual(mockContext);
  });

  it('allows updating route stops', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setRouteStops([mockStop]);
    });

    expect(result.current.state.routeStops).toHaveLength(1);
    expect(result.current.state.routeStops[0].id).toBe('stop-1');
  });

  it('allows highlighting a segment', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.highlightSegment(3);
    });

    expect(result.current.state.highlightedSegment).toBe(3);
  });

  it('allows clearing segment highlight', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.highlightSegment(3);
    });
    act(() => {
      result.current.actions.highlightSegment(null);
    });

    expect(result.current.state.highlightedSegment).toBeNull();
  });

  it('allows setting insertion preview', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    const preview = {
      candidateId: 'cand-1',
      candidateName: 'Jana',
      coordinates: { lat: 49.19, lng: 16.61 },
      insertAfterIndex: 1,
      insertBeforeIndex: 2,
    };

    act(() => {
      result.current.actions.setInsertionPreview(preview);
    });

    expect(result.current.state.insertionPreview).toEqual(preview);
  });

  it('allows setting route geometry', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });
    const geo: [number, number][] = [[16.61, 49.19], [16.62, 49.20]];

    act(() => {
      result.current.actions.setRouteGeometry(geo);
    });

    expect(result.current.state.routeGeometry).toEqual(geo);
  });

  it('allows setting return to depot leg', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setReturnToDepotLeg({ distanceKm: 12.5, durationMinutes: 18 });
    });

    expect(result.current.state.returnToDepotLeg).toEqual({ distanceKm: 12.5, durationMinutes: 18 });
  });

  it('allows setting route buffer', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setRouteBuffer(10, 5);
    });

    expect(result.current.state.routeBufferPercent).toBe(10);
    expect(result.current.state.routeBufferFixedMinutes).toBe(5);
  });

  it('allows setting route warnings', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setRouteWarnings([{ warningType: 'late', message: 'Late arrival' }]);
    });

    expect(result.current.state.routeWarnings).toHaveLength(1);
    expect(result.current.state.routeWarnings[0].warningType).toBe('late');
  });

  it('allows setting break warnings', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setBreakWarnings(['Break too late']);
    });

    expect(result.current.state.breakWarnings).toEqual(['Break too late']);
  });

  it('allows setting metrics', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    const metrics = {
      distanceKm: 45.2,
      travelTimeMin: 68,
      serviceTimeMin: 300,
      loadPercent: 85,
      slackMin: 20,
      stopCount: 6,
    };

    act(() => {
      result.current.actions.setMetrics(metrics);
    });

    expect(result.current.state.metrics).toEqual(metrics);
  });

  it('notifies all consumers on change', () => {
    let consumer1Value: string | null = 'initial';
    let consumer2Value: string | null = 'initial';

    function Consumer1() {
      const { state } = usePanelState();
      consumer1Value = state.selectedCustomerId;
      return null;
    }

    function Consumer2() {
      const { state } = usePanelState();
      consumer2Value = state.selectedCustomerId;
      return null;
    }

    function Mutator() {
      const { actions } = usePanelState();
      return (
        <button onClick={() => actions.selectCustomer('shared-cust')}>
          select
        </button>
      );
    }

    render(
      <PanelStateProvider>
        <Consumer1 />
        <Consumer2 />
        <Mutator />
      </PanelStateProvider>
    );

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });

    expect(consumer1Value).toBe('shared-cust');
    expect(consumer2Value).toBe('shared-cust');
  });

  it('accepts activePageContext prop', () => {
    const { result } = renderHook(() => usePanelState(), {
      wrapper: ({ children }) => (
        <PanelStateProvider activePageContext="plan">{children}</PanelStateProvider>
      ),
    });

    expect(result.current.state.activePageContext).toBe('plan');
  });

  it('setSelectedCandidatesForMap stores an array in state', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    const candidates = [
      { id: 'c1', name: 'Alice', coordinates: { lat: 50.1, lng: 14.1 } },
      { id: 'c2', name: 'Bob',   coordinates: { lat: 50.2, lng: 14.2 } },
    ];

    act(() => {
      result.current.actions.setSelectedCandidatesForMap(candidates);
    });

    expect(result.current.state.selectedCandidatesForMap).toEqual(candidates);
  });

  it('setSelectedCandidatesForMap with empty array clears state', () => {
    const { result } = renderHook(() => usePanelState(), { wrapper });

    act(() => {
      result.current.actions.setSelectedCandidatesForMap([
        { id: 'c1', name: 'Alice', coordinates: { lat: 50.1, lng: 14.1 } },
      ]);
    });
    act(() => {
      result.current.actions.setSelectedCandidatesForMap([]);
    });

    expect(result.current.state.selectedCandidatesForMap).toEqual([]);
  });

  it('throws when usePanelState used outside provider', () => {
    const consoleError = console.error;
    console.error = () => {};

    expect(() => renderHook(() => usePanelState())).toThrow();

    console.error = consoleError;
  });
});
