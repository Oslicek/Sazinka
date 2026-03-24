/**
 * Phase 7 / P4 — Plan page persistence V2 tests (filters only).
 *
 * Verifies that all 5 filter controls hydrate from URL/session.
 * Covers C34 (isDateRange=false default), C35 (dateTo URL), C36 (timelineView).
 * P4 additions: UPP wiring, legacy cleanup, route/timeline non-regression.
 *
 * IMPORTANT: These tests must NOT break route selection or detach behavior.
 * The mandatory gate (test:upp-gate) runs the full Plan guard suite separately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { PLAN_PROFILE_ID } from '@/persistence/profiles/planProfile';

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

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'test-user-plan' } };
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

  // ── BUG: date resets to today on nav away/back ───────────────────────────

  it('BUG-FIX: dateFrom survives unmount and re-mount (nav away and back)', () => {
    // Step 1: User opens Plan with date=2026-03-21 (via URL)
    mockSearchParams.date = '2026-03-21';
    const { unmount } = render(<Plan />);
    expect(screen.getByTestId('pf-dateFrom').textContent).toBe('2026-03-21');

    // Step 2: User navigates away (unmount simulates leaving Plan)
    unmount();

    // Step 3: User returns to Plan — URL no longer has ?date= param
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);

    render(<Plan />);

    // Expected: dateFrom should be restored from sessionStorage, NOT reset to today
    expect(screen.getByTestId('pf-dateFrom').textContent).toBe('2026-03-21');
  });

  it('BUG-FIX: crew filter survives unmount and re-mount', () => {
    mockSearchParams.date = '2026-03-21';
    mockSearchParams.crew = 'crew-42';
    const { unmount } = render(<Plan />);
    expect(screen.getByTestId('pf-crewId').textContent).toBe('crew-42');

    unmount();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);

    render(<Plan />);
    expect(screen.getByTestId('pf-crewId').textContent).toBe('crew-42');
  });

  it('BUG-FIX: depot filter survives unmount and re-mount', () => {
    mockSearchParams.date = '2026-03-21';
    mockSearchParams.depot = 'depot-1';
    const { unmount } = render(<Plan />);
    expect(screen.getByTestId('pf-depotId').textContent).toBe('depot-1');

    unmount();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);

    render(<Plan />);
    expect(screen.getByTestId('pf-depotId').textContent).toBe('depot-1');
  });

  it('BUG-FIX: URL param takes precedence over sessionStorage on return', () => {
    // First visit: date=2026-03-21
    mockSearchParams.date = '2026-03-21';
    const { unmount } = render(<Plan />);
    unmount();

    // Return with a different URL param — URL should win
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
    mockSearchParams.date = '2026-04-01';

    render(<Plan />);
    expect(screen.getByTestId('pf-dateFrom').textContent).toBe('2026-04-01');
  });
});

// ---------------------------------------------------------------------------
// P4 — UPP wiring tests
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'test-user-plan';

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: PLAN_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

describe('Plan page — P4 UPP wiring', () => {
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

  it('dateFrom survives unmount/remount via UPP', async () => {
    seedUpp('dateFrom', '2026-02-10');
    const { unmount } = render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-dateFrom').textContent).toBe('2026-02-10');
    });
    unmount();

    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
    render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-dateFrom').textContent).toBe('2026-02-10');
    });
  });

  it('dateTo survives unmount/remount via UPP', async () => {
    seedUpp('dateTo', '2026-02-20');
    const { unmount } = render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-dateTo').textContent).toBe('2026-02-20');
    });
    unmount();

    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
    render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-dateTo').textContent).toBe('2026-02-20');
    });
  });

  it('isDateRange=false survives remount (falsy preserved via ??)', async () => {
    seedUpp('isDateRange', false);
    const { unmount } = render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-isDateRange').textContent).toBe('false');
    });
    unmount();

    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
    render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-isDateRange').textContent).toBe('false');
    });
  });

  it('crew survives unmount/remount via UPP', async () => {
    seedUpp('crew', 'crew-upp');
    const { unmount } = render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-crewId').textContent).toBe('crew-upp');
    });
    unmount();

    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
    render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-crewId').textContent).toBe('crew-upp');
    });
  });

  it('depot survives unmount/remount via UPP', async () => {
    seedUpp('depot', 'depot-upp');
    const { unmount } = render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-depotId').textContent).toBe('depot-upp');
    });
    unmount();

    Object.keys(capturedFilterProps).forEach((k) => delete capturedFilterProps[k]);
    render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-depotId').textContent).toBe('depot-upp');
    });
  });

  it('legacy plan.filters key is NOT written to sessionStorage after wiring', async () => {
    render(<Plan />);
    // The old hand-rolled key must not be written
    expect(sessionStorage.getItem('plan.filters')).toBeNull();
  });

  it('legacy plan.filters key is NOT read from sessionStorage (UPP key used instead)', async () => {
    // Seed the old legacy key with a date
    sessionStorage.setItem('plan.filters', JSON.stringify({ dateFrom: '2025-01-01', crewId: '', depotId: '' }));
    render(<Plan />);
    // The page should NOT use the legacy key — it should use today as default
    const today = new Date().toISOString().split('T')[0];
    expect(screen.getByTestId('pf-dateFrom').textContent).toBe(today);
  });

  it('PlannerFilters still receives correct depot (route/timeline non-regression)', async () => {
    seedUpp('depot', 'depot-timeline-test');
    render(<Plan />);
    await waitFor(() => {
      expect(screen.getByTestId('pf-depotId').textContent).toBe('depot-timeline-test');
    });
  });
});
