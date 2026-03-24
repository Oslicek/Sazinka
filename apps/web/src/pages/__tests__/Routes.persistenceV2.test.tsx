/**
 * Phase 6 / P3 — Routes page persistence V2 tests.
 *
 * Verifies that all 5 filter controls hydrate from URL/session.
 * Covers C32 (isDateRange persistence), C33 (dateTo URL persistence).
 * P3 additions: unmount/remount survival, falsy preservation, server defaults.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { ROUTES_PROFILE_ID } from '@/persistence/profiles/routesProfile';

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
  useNatsStore: vi.fn(() => ({ isConnected: false })),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: 'test-user-routes' } };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue({ depots: [], preferences: null }),
}));

vi.mock('@/services/routeService', () => ({
  listRoutes: vi.fn().mockResolvedValue({ routes: [] }),
  deleteRoute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Component mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/shared/PlannerFilters', () => ({
  PlannerFilters: ({
    dateFrom,
    dateTo,
    isDateRange,
    filterCrewId,
    filterDepotId,
  }: {
    dateFrom: string;
    dateTo: string;
    isDateRange: boolean;
    filterCrewId: string;
    filterDepotId: string;
  }) => (
    <div data-testid="planner-filters">
      <span data-testid="dateFrom">{dateFrom}</span>
      <span data-testid="dateTo">{dateTo}</span>
      <span data-testid="isDateRange">{String(isDateRange)}</span>
      <span data-testid="crewId">{filterCrewId}</span>
      <span data-testid="depotId">{filterDepotId}</span>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { Routes } from '../Routes';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Routes page — persistence V2 (Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('renders without crash', () => {
    expect(() => render(<Routes />)).not.toThrow();
  });

  it('URL dateFrom param hydrates dateFrom filter', () => {
    mockSearchParams.dateFrom = '2026-03-01';
    render(<Routes />);
    expect(screen.getByTestId('dateFrom').textContent).toBe('2026-03-01');
  });

  it('URL dateTo param hydrates dateTo filter (C33)', () => {
    mockSearchParams.dateTo = '2026-03-31';
    render(<Routes />);
    expect(screen.getByTestId('dateTo').textContent).toBe('2026-03-31');
  });

  it('URL crew param hydrates crew filter', () => {
    mockSearchParams.crew = 'crew-42';
    render(<Routes />);
    expect(screen.getByTestId('crewId').textContent).toBe('crew-42');
  });

  it('URL depot param hydrates depot filter', () => {
    mockSearchParams.depot = 'depot-1';
    render(<Routes />);
    expect(screen.getByTestId('depotId').textContent).toBe('depot-1');
  });

  it('isDateRange defaults to true (C32)', () => {
    render(<Routes />);
    expect(screen.getByTestId('isDateRange').textContent).toBe('true');
  });

  it('dateFrom defaults to weekAgo when no URL param', () => {
    render(<Routes />);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(screen.getByTestId('dateFrom').textContent).toBe(weekAgo);
  });

  it('dateTo defaults to weekAhead when no URL param', () => {
    render(<Routes />);
    const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    expect(screen.getByTestId('dateTo').textContent).toBe(weekAhead);
  });

  it('both dateFrom and dateTo from URL are applied together', () => {
    mockSearchParams.dateFrom = '2026-01-01';
    mockSearchParams.dateTo = '2026-01-31';
    render(<Routes />);
    expect(screen.getByTestId('dateFrom').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('dateTo').textContent).toBe('2026-01-31');
  });

  it('renders without crash with all URL params set', () => {
    mockSearchParams.dateFrom = '2026-03-01';
    mockSearchParams.dateTo = '2026-03-31';
    mockSearchParams.crew = 'crew-1';
    mockSearchParams.depot = 'depot-1';
    expect(() => render(<Routes />)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// P3 — UPP wiring tests
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'test-user-routes';

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: ROUTES_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

describe('Routes page — P3 UPP wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('dateFrom survives unmount/remount', async () => {
    seedUpp('dateFrom', '2026-02-15');
    const { unmount } = render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('dateFrom').textContent).toBe('2026-02-15');
    });
    unmount();

    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('dateFrom').textContent).toBe('2026-02-15');
    });
  });

  it('dateTo survives unmount/remount', async () => {
    seedUpp('dateTo', '2026-02-28');
    const { unmount } = render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('dateTo').textContent).toBe('2026-02-28');
    });
    unmount();

    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('dateTo').textContent).toBe('2026-02-28');
    });
  });

  it('crew survives unmount/remount', async () => {
    seedUpp('crew', 'crew-persisted');
    const { unmount } = render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('crewId').textContent).toBe('crew-persisted');
    });
    unmount();

    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('crewId').textContent).toBe('crew-persisted');
    });
  });

  it('depot survives unmount/remount', async () => {
    seedUpp('depot', 'depot-persisted');
    const { unmount } = render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('depotId').textContent).toBe('depot-persisted');
    });
    unmount();

    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('depotId').textContent).toBe('depot-persisted');
    });
  });

  it('isDateRange survives unmount/remount', async () => {
    seedUpp('isDateRange', true);
    const { unmount } = render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('isDateRange').textContent).toBe('true');
    });
    unmount();

    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('isDateRange').textContent).toBe('true');
    });
  });

  it('persisted isDateRange=false survives remount when profile default is true (no falsy loss)', async () => {
    seedUpp('isDateRange', false);
    const { unmount } = render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('isDateRange').textContent).toBe('false');
    });
    unmount();

    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('isDateRange').textContent).toBe('false');
    });
  });

  it("persisted crew='' survives remount (empty string preserved, not treated as missing)", async () => {
    seedUpp('crew', 'some-crew');
    const { unmount } = render(<Routes />);
    unmount();

    // Now seed empty string
    seedUpp('crew', '');
    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('crewId').textContent).toBe('');
    });
  });

  it('URL dateFrom overrides UPP-persisted dateFrom', async () => {
    seedUpp('dateFrom', '2026-01-01');
    mockSearchParams.dateFrom = '2026-03-15';
    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('dateFrom').textContent).toBe('2026-03-15');
    });
  });

  it('URL crew overrides UPP-persisted crew', async () => {
    seedUpp('crew', 'old-crew');
    mockSearchParams.crew = 'url-crew';
    render(<Routes />);
    await waitFor(() => {
      expect(screen.getByTestId('crewId').textContent).toBe('url-crew');
    });
  });
});
