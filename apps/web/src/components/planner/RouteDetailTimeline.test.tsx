import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteDetailTimeline } from './RouteDetailTimeline';
import type { SavedRouteStop } from '../../services/routeService';

const mockStops: SavedRouteStop[] = [
  {
    id: 's1',
    routeId: 'r1',
    revisionId: 'rev1',
    stopOrder: 1,
    estimatedArrival: '09:00:00',
    estimatedDeparture: '09:45:00',
    distanceFromPreviousKm: 12.5,
    durationFromPreviousMinutes: 18,
    status: 'confirmed',
    customerId: 'cust1',
    customerName: 'Karel Suchý',
    address: 'Lesní 123, Brno',
    customerLat: 49.2,
    customerLng: 16.6,
    scheduledDate: '2026-01-25',
    scheduledTimeStart: '09:00:00',
    scheduledTimeEnd: '09:45:00',
    revisionStatus: 'confirmed',
  },
  {
    id: 's2',
    routeId: 'r1',
    revisionId: 'rev2',
    stopOrder: 2,
    estimatedArrival: '10:00:00',
    estimatedDeparture: '10:30:00',
    distanceFromPreviousKm: 8.3,
    durationFromPreviousMinutes: 12,
    status: 'scheduled',
    customerId: 'cust2',
    customerName: 'Marie Dvořáková',
    address: 'Hlavní 45, Brno',
    customerLat: 49.21,
    customerLng: 16.61,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: 'upcoming',
  },
];

const mockDepot = { name: 'Brno-střed', lat: 49.19, lng: 16.59 };

describe('RouteDetailTimeline', () => {
  it('should render depot at start and end', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    const depotElements = screen.getAllByText(/brno-střed/i);
    expect(depotElements.length).toBeGreaterThanOrEqual(2);
  });

  it('should render all stops with customer names', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/karel suchý/i)).toBeInTheDocument();
    expect(screen.getByText(/marie dvořáková/i)).toBeInTheDocument();
  });

  it('should render time windows for stops', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    // Dohodnuto: 09:00–09:45 or Vypočítáno - formatTime gives HH:MM (appears in segment + stop)
    expect(screen.getAllByText(/09:00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/09:45/).length).toBeGreaterThanOrEqual(1);
  });

  it('should show confirmation badges for stops', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    // First stop: revisionStatus 'confirmed' -> "Potvrzeno"; Second: 'upcoming' -> "Nepotvrzeno"
    expect(screen.getByText('Potvrzeno')).toBeInTheDocument();
    expect(screen.getByText('Nepotvrzeno')).toBeInTheDocument();
  });

  it('should render segments with distance and duration', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/12\.5 km/i)).toBeInTheDocument();
    // formatDurationHm outputs "0h 18min" for 18 minutes
    expect(screen.getByText(/18.*min/i)).toBeInTheDocument();
    expect(screen.getByText(/8\.3 km/i)).toBeInTheDocument();
  });

  it('should call onStopClick when stop card is clicked', () => {
    const onStopClick = vi.fn();
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={onStopClick}
        onSegmentClick={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/karel suchý/i));
    expect(onStopClick).toHaveBeenCalledWith('cust1', 0);
  });

  it('should call onSegmentClick when segment is clicked', () => {
    const onSegmentClick = vi.fn();
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={onSegmentClick}
      />
    );
    // Click on the first segment (depot -> stop 1)
    fireEvent.click(screen.getByText(/12\.5 km/i));
    expect(onSegmentClick).toHaveBeenCalledWith(0);
  });

  it('should highlight selected stop', () => {
    const { container } = render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId="cust1"
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    const selected = container.querySelector('[data-selected="true"]');
    expect(selected).toBeInTheDocument();
  });

  it('should render empty state when no stops', () => {
    render(
      <RouteDetailTimeline
        stops={[]}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/žádné zastávky/i)).toBeInTheDocument();
  });
});
