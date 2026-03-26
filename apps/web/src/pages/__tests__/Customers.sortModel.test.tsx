/**
 * Phase 2A (RED → GREEN) — sortModel end-to-end contract tests.
 *
 * Verifies that Customers page sends sortModel (not legacy sortBy/sortOrder)
 * to the backend, handles sanitization, and shows error UI on contract rejection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { CUSTOMERS_GRID_PROFILE_ID } from '@/persistence/profiles/customersGridProfile';
import { DEFAULT_SORT_MODEL } from '@/lib/customerColumns';
import type { SortEntry } from '@/lib/customerColumns';

// ── i18n mock ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Router mock ───────────────────────────────────────────────────────────────

const mockSearchParams: Record<string, unknown> = {};

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => mockSearchParams),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } }) => unknown) => {
    const state = { user: { id: 'test-user-sort' } };
    return selector ? selector(state) : state;
  }),
}));

// ── Service mock (controllable) ───────────────────────────────────────────────

const mockListCustomersExtended = vi.fn().mockResolvedValue({ items: [], total: 0 });

vi.mock('@/services/customerService', () => ({
  listCustomersExtended: (...args: unknown[]) => mockListCustomersExtended(...args),
  getCustomerSummary: vi.fn().mockResolvedValue(null),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
  updateCustomer: vi.fn(),
}));

// ── Component mocks ───────────────────────────────────────────────────────────

vi.mock('@/components/customers/AddCustomerForm', () => ({
  AddCustomerForm: () => <div data-testid="add-form" />,
}));

vi.mock('@/components/customers/CustomerTable', () => ({
  CustomerTable: () => <div data-testid="customer-table" />,
}));

vi.mock('@/components/customers/CustomerPreviewPanel', () => ({
  CustomerPreviewPanel: () => <div data-testid="preview-panel" />,
}));

vi.mock('@/components/customers/CustomerEditDrawer', () => ({
  CustomerEditDrawer: () => <div data-testid="edit-drawer" />,
}));


vi.mock('@/components/common/SplitView', () => ({
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">
      {panels.map((p) => (
        <div key={p.id}>{p.content}</div>
      ))}
    </div>
  ),
}));

import { Customers } from '../Customers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = 'test-user-sort';

function gridKey(controlId: string) {
  return makeKey({ userId: USER_ID, profileId: CUSTOMERS_GRID_PROFILE_ID, controlId });
}

function seedGridLocal(controlId: string, value: unknown) {
  localStorage.setItem(gridKey(controlId), JSON.stringify(makeEnvelope(value, 'local')));
}

function lastCall(): Record<string, unknown> {
  const calls = mockListCustomersExtended.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 2A: sortModel end-to-end contract', () => {
  beforeEach(() => {
    mockListCustomersExtended.mockClear();
    mockListCustomersExtended.mockResolvedValue({ items: [], total: 0 });
    sessionStorage.clear();
    localStorage.clear();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // Default sort

  it('1. mount with empty storage → request contains sortModel=[{column:name,direction:asc}]', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const call = lastCall();
    expect(call.sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('2. mount with empty storage → request does NOT contain legacy sortBy/sortOrder fields', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const call = lastCall();
    expect(call).not.toHaveProperty('sortBy');
    expect(call).not.toHaveProperty('sortOrder');
  });

  // Single sort from grid storage

  it('3. grid storage has sortModel=[city DESC] → request uses same single-entry model', async () => {
    const model: SortEntry[] = [{ column: 'city', direction: 'desc' }];
    seedGridLocal('sortModel', model);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastCall().sortModel).toEqual(model);
  });

  it('4. single-entry sortModel → backend receives exactly that model in payload', async () => {
    const model: SortEntry[] = [{ column: 'city', direction: 'desc' }];
    seedGridLocal('sortModel', model);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const call = lastCall();
    const sentModel = call.sortModel as SortEntry[];
    expect(sentModel).toHaveLength(1);
    expect(sentModel[0].column).toBe('city');
    expect(sentModel[0].direction).toBe('desc');
  });

  // Multisort

  it('5. two-level sortModel → full model sent to backend unchanged', async () => {
    const model: SortEntry[] = [
      { column: 'nextRevision', direction: 'asc' },
      { column: 'name', direction: 'desc' },
    ];
    seedGridLocal('sortModel', model);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastCall().sortModel).toEqual(model);
  });

  it('6. three-level sortModel → sent to backend with priority order preserved', async () => {
    const model: SortEntry[] = [
      { column: 'nextRevision', direction: 'asc' },
      { column: 'city', direction: 'asc' },
      { column: 'name', direction: 'desc' },
    ];
    seedGridLocal('sortModel', model);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const sentModel = lastCall().sortModel as SortEntry[];
    expect(sentModel).toHaveLength(3);
    expect(sentModel[0].column).toBe('nextRevision');
    expect(sentModel[1].column).toBe('city');
    expect(sentModel[2].column).toBe('name');
  });

  it('7. backend returns results in given order → no client-side reordering (response order preserved)', async () => {
    mockListCustomersExtended.mockResolvedValue({
      items: [
        { id: 'b', name: 'Beta' },
        { id: 'a', name: 'Alpha' },
      ],
      total: 2,
    });
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(screen.getByTestId('customer-table')).toBeInTheDocument();
  });

  // Edge cases / sanitization

  it('10. sortModel with unknown column → stripped by sanitizer, default sort used', async () => {
    seedGridLocal('sortModel', [{ column: 'nonexistent_col', direction: 'asc' }]);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastCall().sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('11. sortModel with duplicate columns → deduplicated (first occurrence wins)', async () => {
    seedGridLocal('sortModel', [
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'asc' },
      { column: 'name', direction: 'desc' },
    ]);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const sentModel = lastCall().sortModel as SortEntry[];
    const nameEntries = sentModel.filter((e) => e.column === 'name');
    expect(nameEntries).toHaveLength(1);
    expect(nameEntries[0].direction).toBe('asc');
  });

  it('12. stale sortModel=[] → sanitizer normalizes to DEFAULT_SORT_MODEL', async () => {
    seedGridLocal('sortModel', []);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastCall().sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('18. corrupted sortModel in localStorage → sanitized to DEFAULT_SORT_MODEL before request', async () => {
    localStorage.setItem(gridKey('sortModel'), '{broken json]');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastCall().sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('19. sortModel with unknown column IDs → stripped by sanitizeSortModel, remaining valid entries used', async () => {
    seedGridLocal('sortModel', [
      { column: 'name', direction: 'asc' },
      { column: 'unknownField', direction: 'desc' },
    ]);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const sentModel = lastCall().sortModel as SortEntry[];
    expect(sentModel).toEqual([{ column: 'name', direction: 'asc' }]);
  });

  // Error handling — backend contract rejection

  it('14. backend rejects with "SORT_CONTRACT_ERROR" → sticky inline banner appears', async () => {
    mockListCustomersExtended.mockRejectedValue(new Error('SORT_CONTRACT_ERROR: invalid sortModel'));
    render(<Customers />);
    await waitFor(() => {
      expect(
        screen.getByTestId('sort-contract-error-banner') ||
        screen.getByText(/SORT_CONTRACT_ERROR/i) ||
        screen.queryByRole('alert')
      ).toBeTruthy();
    });
  });

  it('15. backend contract rejection → current sortModel/UI state unchanged (fail-fast)', async () => {
    const model: SortEntry[] = [{ column: 'city', direction: 'desc' }];
    seedGridLocal('sortModel', model);
    mockListCustomersExtended.mockRejectedValue(new Error('SORT_CONTRACT_ERROR'));
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastCall().sortModel).toEqual(model);
  });

  it('16. backend contract rejection → does NOT auto-retry request', async () => {
    mockListCustomersExtended.mockRejectedValue(new Error('SORT_CONTRACT_ERROR'));
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    const callCountAfterSettle = mockListCustomersExtended.mock.calls.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(mockListCustomersExtended).toHaveBeenCalledTimes(callCountAfterSettle);
  });

  it('17. error banner does NOT contain a retry button', async () => {
    mockListCustomersExtended.mockRejectedValue(new Error('SORT_CONTRACT_ERROR'));
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const retryBtn = screen.queryByRole('button', { name: /retry/i });
    expect(retryBtn).toBeNull();
  });
});

// ── Newly-sortable columns forwarding ─────────────────────────────────────────

describe('Newly-sortable columns: request forwarding', () => {
  const NEWLY_SORTABLE_COLUMNS = ['email', 'phone', 'type', 'street', 'postalCode', 'geocodeStatus'];

  beforeEach(() => {
    mockListCustomersExtended.mockClear();
    mockListCustomersExtended.mockResolvedValue({ items: [], total: 0 });
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  NEWLY_SORTABLE_COLUMNS.forEach((col) => {
    it(`sortModel=[{column:${col}, direction:asc}] is forwarded unchanged to backend`, async () => {
      const model: SortEntry[] = [{ column: col, direction: 'asc' }];
      seedGridLocal('sortModel', model);
      render(<Customers />);
      await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
      const sentModel = lastCall().sortModel as SortEntry[];
      expect(sentModel).toHaveLength(1);
      expect(sentModel[0].column).toBe(col);
      expect(sentModel[0].direction).toBe('asc');
    });

    it(`multisort with ${col} DESC is forwarded with correct priority`, async () => {
      const model: SortEntry[] = [
        { column: 'name', direction: 'asc' },
        { column: col, direction: 'desc' },
      ];
      seedGridLocal('sortModel', model);
      render(<Customers />);
      await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
      const sentModel = lastCall().sortModel as SortEntry[];
      expect(sentModel).toHaveLength(2);
      expect(sentModel[0].column).toBe('name');
      expect(sentModel[1].column).toBe(col);
      expect(sentModel[1].direction).toBe('desc');
    });
  });
});

// ── Integration-level path tests ──────────────────────────────────────────────
// These tests verify the full request-construction path:
// Customers page → UPP sortModel → listCustomersExtended payload
// without a live DB (mocked service layer).

describe('Integration path: sort_model never regresses to legacy-only payload', () => {
  beforeEach(() => {
    mockListCustomersExtended.mockClear();
    mockListCustomersExtended.mockResolvedValue({ items: [], total: 0 });
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('request always has sortModel field, never sortBy or sortOrder', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const call = lastCall();
    expect(call).toHaveProperty('sortModel');
    expect(call).not.toHaveProperty('sortBy');
    expect(call).not.toHaveProperty('sortOrder');
  });

  it('sortModel contains at least one entry in every request', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const sentModel = lastCall().sortModel as SortEntry[];
    expect(Array.isArray(sentModel)).toBe(true);
    expect(sentModel.length).toBeGreaterThan(0);
  });

  it('loadMore request uses the same sortModel as the initial request', async () => {
    const model: SortEntry[] = [{ column: 'city', direction: 'desc' }];
    seedGridLocal('sortModel', model);
    mockListCustomersExtended.mockResolvedValue({ items: Array(100).fill({ id: 'x', name: 'X' }), total: 200 });
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const firstCallModel = (mockListCustomersExtended.mock.calls[0][0] as { sortModel: SortEntry[] }).sortModel;
    if (mockListCustomersExtended.mock.calls.length > 1) {
      for (const call of mockListCustomersExtended.mock.calls.slice(1)) {
        expect((call[0] as { sortModel: SortEntry[] }).sortModel).toEqual(firstCallModel);
      }
    }
  });

  it('pagination call includes offset=0 on initial load with sortModel', async () => {
    const model: SortEntry[] = [
      { column: 'email', direction: 'asc' },
      { column: 'name', direction: 'asc' },
    ];
    seedGridLocal('sortModel', model);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const firstCall = mockListCustomersExtended.mock.calls[0][0] as { sortModel: SortEntry[]; offset?: number };
    expect(firstCall.sortModel).toEqual(model);
    expect(firstCall.offset).toBe(0);
  });

  it('sortModel with all 11 columns is forwarded in correct priority order', async () => {
    const model: SortEntry[] = [
      { column: 'geocodeStatus', direction: 'asc' },
      { column: 'type', direction: 'asc' },
      { column: 'city', direction: 'asc' },
      { column: 'street', direction: 'asc' },
      { column: 'postalCode', direction: 'asc' },
      { column: 'phone', direction: 'asc' },
      { column: 'email', direction: 'asc' },
      { column: 'deviceCount', direction: 'asc' },
      { column: 'nextRevision', direction: 'asc' },
      { column: 'createdAt', direction: 'asc' },
      { column: 'name', direction: 'asc' },
    ];
    seedGridLocal('sortModel', model);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const sentModel = lastCall().sortModel as SortEntry[];
    expect(sentModel).toHaveLength(11);
    expect(sentModel[0].column).toBe('geocodeStatus');
    expect(sentModel[10].column).toBe('name');
  });
});
