import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { usePanelState } from '../../hooks/usePanelState';
import { RouteMapPanel } from '../RouteMapPanel';
import type { PanelActions } from '../../types/panelState';
import type { SavedRouteStop } from '../../services/routeService';
import type { InsertionPreview } from '../../components/planner/RouteMapPanel';

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

function makeActionsCapture() {
  const ref: { actions: PanelActions | null } = { actions: null };
  function ActionsCapture() {
    ref.actions = usePanelState().actions;
    return null;
  }
  return { ref, ActionsCapture };
}

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

describe('panels/RouteMapPanel', () => {
  beforeEach(() => {
    mockProps.current = {};
  });

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
});
