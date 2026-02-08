import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteListPanel } from './RouteListPanel';
import type { SavedRoute } from '../../services/routeService';

const makeRoute = (overrides: Partial<SavedRoute> = {}): SavedRoute => ({
  id: 'r1',
  userId: 'u1',
  crewId: 'c1',
  crewName: 'Petr',
  date: '2026-01-26',
  status: 'optimized',
  totalDistanceKm: 48.2,
  totalDurationMinutes: 200,
  optimizationScore: 85,
  stopsCount: 5,
  createdAt: '2026-01-25T10:00:00',
  updatedAt: '2026-01-25T10:00:00',
  ...overrides,
});

describe('RouteListPanel', () => {
  it('should render loading state', () => {
    render(
      <RouteListPanel routes={[]} isLoading={true} selectedRouteId={null} onSelectRoute={() => {}} />
    );
    expect(screen.getByText(/načítám/i)).toBeInTheDocument();
  });

  it('should render empty state when no routes', () => {
    render(
      <RouteListPanel routes={[]} isLoading={false} selectedRouteId={null} onSelectRoute={() => {}} />
    );
    expect(screen.getByText(/žádné naplánované cesty/i)).toBeInTheDocument();
  });

  it('should render route cards with crew name and date', () => {
    const routes = [makeRoute()];
    render(
      <RouteListPanel routes={routes} isLoading={false} selectedRouteId={null} onSelectRoute={() => {}} />
    );
    expect(screen.getByText(/petr/i)).toBeInTheDocument();
    expect(screen.getByText(/5/)).toBeInTheDocument(); // stops count
  });

  it('should show distance and duration', () => {
    const routes = [makeRoute({ totalDistanceKm: 48.2, totalDurationMinutes: 200 })];
    render(
      <RouteListPanel routes={routes} isLoading={false} selectedRouteId={null} onSelectRoute={() => {}} />
    );
    expect(screen.getByText(/48/)).toBeInTheDocument();
  });

  it('should highlight selected route', () => {
    const routes = [makeRoute({ id: 'r1' }), makeRoute({ id: 'r2', crewName: 'Karel' })];
    const { container } = render(
      <RouteListPanel routes={routes} isLoading={false} selectedRouteId="r1" onSelectRoute={() => {}} />
    );
    const selected = container.querySelector('[data-selected="true"]');
    expect(selected).toBeInTheDocument();
  });

  it('should call onSelectRoute when card is clicked', () => {
    const onSelect = vi.fn();
    const routes = [makeRoute({ id: 'r1' })];
    render(
      <RouteListPanel routes={routes} isLoading={false} selectedRouteId={null} onSelectRoute={onSelect} />
    );
    fireEvent.click(screen.getByText(/petr/i));
    expect(onSelect).toHaveBeenCalledWith('r1');
  });

  it('should render multiple routes', () => {
    const routes = [
      makeRoute({ id: 'r1', crewName: 'Petr', date: '2026-01-26' }),
      makeRoute({ id: 'r2', crewName: 'Karel', date: '2026-01-27', stopsCount: 3 }),
    ];
    render(
      <RouteListPanel routes={routes} isLoading={false} selectedRouteId={null} onSelectRoute={() => {}} />
    );
    expect(screen.getByText(/petr/i)).toBeInTheDocument();
    expect(screen.getByText(/karel/i)).toBeInTheDocument();
  });
});
