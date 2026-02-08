import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteDetailTimeline } from './RouteDetailTimeline';
import type { SavedRoute, SavedRouteStop } from '../../services/routeService';

const mockRoute: SavedRoute = {
  id: 'r1',
  userId: 'u1',
  crewId: 'c1',
  crewName: 'Petr',
  date: '2026-01-26',
  status: 'optimized',
  totalDistanceKm: 48.2,
  totalDurationMinutes: 200,
  optimizationScore: 85,
  stopsCount: 2,
  createdAt: '2026-01-25T10:00:00',
  updatedAt: '2026-01-25T10:00:00',
};

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
    revisionStatus: 'scheduled',
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
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
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
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
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
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/09:00/)).toBeInTheDocument();
    expect(screen.getByText(/09:45/)).toBeInTheDocument();
  });

  it('should show confirmation badges for stops', () => {
    render(
      <RouteDetailTimeline
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    // "Potvrzeno" for confirmed and "Nepotvrzeno" for scheduled
    const badges = screen.getAllByText(/potvrzeno/i);
    expect(badges.length).toBe(2);
    expect(screen.getByText('Potvrzeno')).toBeInTheDocument();
    expect(screen.getByText('Nepotvrzeno')).toBeInTheDocument();
  });

  it('should render segments with distance and duration', () => {
    render(
      <RouteDetailTimeline
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/12\.5 km/i)).toBeInTheDocument();
    expect(screen.getByText(/18 min/i)).toBeInTheDocument();
    expect(screen.getByText(/8\.3 km/i)).toBeInTheDocument();
  });

  it('should call onStopClick when stop card is clicked', () => {
    const onStopClick = vi.fn();
    render(
      <RouteDetailTimeline
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
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
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
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
        route={mockRoute}
        stops={mockStops}
        depot={mockDepot}
        selectedStopId="cust1"
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
        route={mockRoute}
        stops={[]}
        depot={mockDepot}
        selectedStopId={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/žádné zastávky/i)).toBeInTheDocument();
  });
});
