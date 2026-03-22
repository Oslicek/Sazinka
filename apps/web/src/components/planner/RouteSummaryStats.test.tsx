import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteSummaryStats } from './RouteSummaryStats';
import type { RouteMetrics } from './CapacityMetrics';

const baseMetrics: RouteMetrics = {
  distanceKm: 12.3,
  travelTimeMin: 45,
  serviceTimeMin: 90,
  loadPercent: 50,
  slackMin: 30,
  stopCount: 3,
};

describe('RouteSummaryStats', () => {
  it('shows start/end and computes total from window when stopCount > 0', () => {
    render(
      <RouteSummaryStats
        routeStartTime="08:00"
        routeEndTime="10:30"
        metrics={baseMetrics}
        stopCount={2}
      />
    );

    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.getByText('10:30')).toBeInTheDocument();
    // 2h30 = 150 min
    expect(screen.getByText('2h 30min')).toBeInTheDocument();
  });

  it('falls back to travel + service when start/end missing or stopCount is 0', () => {
    render(
      <RouteSummaryStats
        routeStartTime="08:00"
        routeEndTime="10:00"
        metrics={baseMetrics}
        stopCount={0}
      />
    );

    // totalTimeMinutes path skipped (stopCount 0); uses metrics 45+90 = 135
    expect(screen.getByText('2h 15min')).toBeInTheDocument();
  });

  it('uses metrics sum for total when route times incomplete', () => {
    render(
      <RouteSummaryStats
        routeStartTime={null}
        routeEndTime={null}
        metrics={baseMetrics}
        stopCount={2}
      />
    );

    expect(screen.getByText('2h 15min')).toBeInTheDocument();
  });

  it('shows em dash for work/travel/total when metrics null', () => {
    const { container } = render(
      <RouteSummaryStats
        routeStartTime={null}
        routeEndTime={null}
        metrics={null}
        stopCount={0}
      />
    );

    const emDash = '\u2014';
    const matches = container.textContent?.split(emDash).length ?? 0;
    expect(matches).toBeGreaterThan(3);
  });

  it('formats distance from metrics', () => {
    render(
      <RouteSummaryStats
        routeStartTime={null}
        routeEndTime={null}
        metrics={baseMetrics}
        stopCount={1}
      />
    );

    expect(screen.getByText('12.3 km')).toBeInTheDocument();
  });

  it('renders stop count', () => {
    render(
      <RouteSummaryStats
        routeStartTime={null}
        routeEndTime={null}
        metrics={baseMetrics}
        stopCount={5}
      />
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
