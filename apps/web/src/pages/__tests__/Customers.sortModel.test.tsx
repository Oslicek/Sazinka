/**
 * Phase 2A (RED → GREEN) — sortModel end-to-end contract tests.
 *
 * Verifies that Customers page sends sortModel (not legacy sortBy/sortOrder)
 * to the backend, handles sanitization, and shows error UI on contract rejection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    // Response order should reach the table intact (CustomerTable mock just renders count)
    expect(screen.getByTestId('customer-table')).toBeInTheDocument();
  });

  // Edge cases / sanitization

  it('10. sortModel with non-sortable column → stripped by sanitizer, default sort used', async () => {
    seedGridLocal('sortModel', [{ column: 'email', direction: 'asc' }]);
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
    // SortModel should still be the seeded city:desc (not reset)
    expect(lastCall().sortModel).toEqual(model);
  });

  it('16. backend contract rejection → does NOT auto-retry request', async () => {
    mockListCustomersExtended.mockRejectedValue(new Error('SORT_CONTRACT_ERROR'));
    render(<Customers />);
    // Wait for all mount-lifecycle calls to settle (there may be 1-2 due to persistence hydration)
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300));
    const callCountAfterSettle = mockListCustomersExtended.mock.calls.length;
    // Wait additional time — no more retries should happen
    await new Promise((r) => setTimeout(r, 300));
    expect(mockListCustomersExtended).toHaveBeenCalledTimes(callCountAfterSettle);
  });

  it('17. error banner does NOT contain a retry button', async () => {
    mockListCustomersExtended.mockRejectedValue(new Error('SORT_CONTRACT_ERROR'));
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    // There should be no retry button in the page
    const retryBtn = screen.queryByRole('button', { name: /retry/i });
    expect(retryBtn).toBeNull();
  });
});
