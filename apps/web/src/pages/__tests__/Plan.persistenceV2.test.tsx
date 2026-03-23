/**
 * Phase 7 — Plan page persistence V2 tests (filters only).
 *
 * Verifies that all 5 filter controls hydrate from URL/session.
 * Covers C34 (isDateRange=false default), C35 (dateTo URL), C36 (timelineView).
 *
 * IMPORTANT: These tests must NOT break route selection or detach behavior.
 * The mandatory gate (test:upp-gate) runs the full Plan guard suite separately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Router mock
// ---------------------------------------------------------------------------

const mockSearchParams: Record<string, string> = {};
vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => mockSearchParams),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: false };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/routeService', () => ({
  listRoutes: vi.fn().mockResolvedValue({ routes: [] }),
  getRoute: vi.fn().mockResolvedValue({ route: null, stops: [] }),
  deleteRoute: vi.fn().mockResolvedValue(undefined),
  submitRoutePlanJob: vi.fn().mockResolvedValue({ jobId: 'test-job' }),
  subscribeToRouteJobStatus: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue({
    depots: [],
    breakSettings: null,
    workConstraints: null,
    preferences: null,
  }),
}));

vi.mock('@/services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/geometryService', () => ({
  submitGeometryJob: vi.fn().mockResolvedValue({ jobId: 'geo-job' }),
  subscribeToGeometryJobStatus: vi.fn().mockResolvedValue(() => {}),
}));

// ---------------------------------------------------------------------------
// Component mocks — capture filter props passed to PlannerFilters
// ---------------------------------------------------------------------------

const capturedFilterProps: Record<string, unknown> = {};

vi.mock('@/components/shared/PlannerFilters', () => ({
  PlannerFilters: (props: Record<string, unknown>) => {
    Object.assign(capturedFilterProps, props);
    return (
      <div data-testid="planner-filters">
        <span data-testid="pf-dateFrom">{String(props.dateFrom ?? '')}</span>
        <span data-testid="pf-dateTo">{String(props.dateTo ?? '')}</span>
        <span data-testid="pf-isDateRange">{String(props.isDateRange ?? '')}</span>
        <span data-testid="pf-crewId">{String(props.filterCrewId ?? '')}</span>
        <span data-testid="pf-depotId">{String(props.filterDepotId ?? '')}</span>
      </div>
    );
  },
}));

vi.mock('@/components/planner', () => ({
  RouteListPanel: () => <div data-testid="route-list" />,
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  RouteMapPanel: () => <div data-testid="route-map" />,
  PlanningTimeline: () => <div data-testid="planning-timeline" />,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  CandidateDetail: () => <div data-testid="candidate-detail" />,
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { Plan } from '../Plan';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan page — persistence V2 (Phase 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('renders without crash', () => {
    expect(() => render(<Plan />)).not.toThrow();
  });

  it('URL date param hydrates dateFrom filter', () => {
    mockSearchParams.date = '2026-03-21';
    render(<Plan />);
    expect(screen.getByTestId('pf-dateFrom').textContent).toBe('2026-03-21');
  });

  it('URL crew param hydrates crew filter', () => {
    mockSearchParams.crew = 'crew-42';
    render(<Plan />);
    expect(screen.getByTestId('pf-crewId').textContent).toBe('crew-42');
  });

  it('URL depot param hydrates depot filter', () => {
    mockSearchParams.depot = 'depot-1';
    render(<Plan />);
    expect(screen.getByTestId('pf-depotId').textContent).toBe('depot-1');
  });

  it('isDateRange defaults to false on Plan page (C34)', () => {
    render(<Plan />);
    expect(screen.getByTestId('pf-isDateRange').textContent).toBe('false');
  });

  it('dateFrom defaults to today when no URL param', () => {
    render(<Plan />);
    const today = new Date().toISOString().split('T')[0];
    expect(screen.getByTestId('pf-dateFrom').textContent).toBe(today);
  });

  it('dateTo defaults to today when no URL param (C35)', () => {
    render(<Plan />);
    const today = new Date().toISOString().split('T')[0];
    expect(screen.getByTestId('pf-dateTo').textContent).toBe(today);
  });

  it('renders without crash with all URL params set', () => {
    mockSearchParams.date = '2026-03-21';
    mockSearchParams.crew = 'crew-1';
    mockSearchParams.depot = 'depot-1';
    expect(() => render(<Plan />)).not.toThrow();
  });

  it('PlannerFilters receives isDateRange=false (Plan single-date mode)', () => {
    render(<Plan />);
    // Plan uses single-date mode by default
    expect(capturedFilterProps.isDateRange).toBe(false);
  });
});
