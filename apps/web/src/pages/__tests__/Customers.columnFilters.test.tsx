/**
 * Phase 6A: column filters wired on the Customers page.
 *
 * Tests:
 * - UPP grid storage → columnFilters forwarded to listCustomersExtended
 * - columnFilters omitted from payload when empty / unset
 * - getCustomerSummary never receives columnFilters
 * - CustomerTable receives columnFilters + onColumnFiltersChange props
 * - activeFilterCount includes column filter count
 * - handleClearAllFilters resets columnFilters
 * - Legacy geocodeFilter/typeFilter stale storage → no crash, no payload
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { CUSTOMERS_GRID_PROFILE_ID } from '@/persistence/profiles/customersGridProfile';
import { CUSTOMERS_PROFILE_ID } from '@/persistence/profiles/customersProfile';
import type { ColumnFilter } from '@shared/customer';

// ── i18n mock ──────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Router mock ────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ── Store mocks ────────────────────────────────────────────────────────────────

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } }) => unknown) => {
    const state = { user: { id: USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

// ── Service mock ───────────────────────────────────────────────────────────────

const mockListCustomersExtended = vi.fn().mockResolvedValue({ items: [], total: 0 });
const mockGetCustomerSummary = vi.fn().mockResolvedValue(null);

vi.mock('@/services/customerService', () => ({
  listCustomersExtended: (...args: unknown[]) => mockListCustomersExtended(...args),
  getCustomerSummary: (...args: unknown[]) => mockGetCustomerSummary(...args),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
  updateCustomer: vi.fn(),
}));

// ── CustomerTable mock — captures props ────────────────────────────────────────

type TableProps = {
  columnFilters?: ColumnFilter[];
  onColumnFiltersChange?: (filters: ColumnFilter[]) => void;
  distinctContext?: unknown;
};

let lastTableProps: TableProps = {};

vi.mock('@/components/customers/CustomerTable', () => ({
  CustomerTable: (props: TableProps) => {
    lastTableProps = props;
    return <div data-testid="customer-table" />;
  },
}));

// ── Component stub mocks ───────────────────────────────────────────────────────

vi.mock('@/components/customers/AddCustomerForm', () => ({
  AddCustomerForm: () => <div data-testid="add-form" />,
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
      {panels.map((p) => <div key={p.id}>{p.content}</div>)}
    </div>
  ),
}));

import { Customers } from '../Customers';

// ── Helpers ────────────────────────────────────────────────────────────────────

const USER_ID = 'test-user-cf';

function gridKey(controlId: string) {
  return makeKey({ userId: USER_ID, profileId: CUSTOMERS_GRID_PROFILE_ID, controlId });
}

function sessionKey(controlId: string) {
  return makeKey({ userId: USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId });
}

function seedGridLocal(controlId: string, value: unknown) {
  localStorage.setItem(gridKey(controlId), JSON.stringify(makeEnvelope(value, 'local')));
}

function seedSessionFilter(controlId: string, value: unknown) {
  sessionStorage.setItem(sessionKey(controlId), JSON.stringify(makeEnvelope(value, 'session')));
}

function lastListCall(): Record<string, unknown> {
  const calls = mockListCustomersExtended.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Phase 6A: columnFilters → request payload', () => {
  beforeEach(() => {
    mockListCustomersExtended.mockClear();
    mockGetCustomerSummary.mockClear();
    mockListCustomersExtended.mockResolvedValue({ items: [], total: 0 });
    mockGetCustomerSummary.mockResolvedValue(null);
    lastTableProps = {};
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // ── 1. Payload forwarding ────────────────────────────────────────────────────

  it('1. no column filters in UPP → columnFilters absent or empty in request', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const call = lastListCall();
    // columnFilters should be absent or empty array (both are valid "no filters")
    const cf = call.columnFilters as ColumnFilter[] | undefined;
    expect(!cf || cf.length === 0).toBe(true);
  });

  it('2. checklist filter in UPP → forwarded to listCustomersExtended', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Prague', 'Brno'] }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastListCall().columnFilters).toEqual(filters);
  });

  it('3. date range filter in UPP → forwarded to listCustomersExtended', async () => {
    const filters: ColumnFilter[] = [{ type: 'dateRange', column: 'nextRevision', from: '2026-01-01', to: '2026-12-31' }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastListCall().columnFilters).toEqual(filters);
  });

  it('4. multiple filters in UPP → all forwarded to listCustomersExtended', async () => {
    const filters: ColumnFilter[] = [
      { type: 'checklist', column: 'city', values: ['Prague'] },
      { type: 'dateRange', column: 'nextRevision', from: '2026-01-01' },
    ];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const cf = lastListCall().columnFilters as ColumnFilter[];
    expect(cf).toHaveLength(2);
    expect(cf[0].column).toBe('city');
    expect(cf[1].column).toBe('nextRevision');
  });

  // ── 2. Summary never gets columnFilters ─────────────────────────────────────

  it('5. getCustomerSummary called WITHOUT columnFilters argument', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Prague'] }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockGetCustomerSummary).toHaveBeenCalled());
    // Summary takes no arguments — called with zero or no arg containing columnFilters
    const summaryCallArgs = mockGetCustomerSummary.mock.calls[0] ?? [];
    if (summaryCallArgs.length > 0) {
      const summaryArg = summaryCallArgs[0] as Record<string, unknown> | undefined;
      expect(summaryArg?.columnFilters).toBeUndefined();
    }
    // If no args, that's also fine
    expect(true).toBe(true);
  });

  // ── 3. CustomerTable receives props ─────────────────────────────────────────

  it('6. CustomerTable receives columnFilters prop from UPP', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'type', values: ['company'] }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(lastTableProps.columnFilters).toEqual(filters);
  });

  it('7. CustomerTable receives onColumnFiltersChange prop', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(typeof lastTableProps.onColumnFiltersChange).toBe('function');
  });

  it('8. CustomerTable receives distinctContext prop (object)', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    // distinctContext should be an object (even if most fields are absent)
    expect(typeof lastTableProps.distinctContext).toBe('object');
    expect(lastTableProps.distinctContext).not.toBeNull();
  });

  it('9. distinctContext includes columnFilters so backend can apply context-aware filtering', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Prague'] }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const ctx = lastTableProps.distinctContext as Record<string, unknown>;
    expect(ctx.columnFilters).toEqual(filters);
  });

  // ── 4. onColumnFiltersChange → re-fetches with updated filters ───────────────

  it('10. calling onColumnFiltersChange triggers re-fetch with new filters', async () => {
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const initialCallCount = mockListCustomersExtended.mock.calls.length;

    const newFilters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Brno'] }];
    await act(async () => {
      lastTableProps.onColumnFiltersChange?.(newFilters);
    });
    await waitFor(() =>
      expect(mockListCustomersExtended.mock.calls.length).toBeGreaterThan(initialCallCount),
    );
    expect(lastListCall().columnFilters).toEqual(newFilters);
  });

  // ── 5. activeFilterCount includes column filters ─────────────────────────────

  it('11. 0 column filters → activeFilterCount does not include column filters', async () => {
    // No column filters seeded — default activeFilterCount should be 0
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    // No clear-all button visible when count is 0
    expect(screen.queryByTestId('clear-all-btn')).not.toBeInTheDocument();
  });

  it('12. 1 column filter → activeFilterCount counts it (clear-all btn visible)', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Prague'] }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(screen.getByTestId('clear-all-btn')).toBeInTheDocument();
    expect(screen.getByTestId('active-filter-badge')).toBeInTheDocument();
  });

  it('13. 3 column filters → badge shows 3', async () => {
    const filters: ColumnFilter[] = [
      { type: 'checklist', column: 'city', values: ['Prague'] },
      { type: 'checklist', column: 'type', values: ['company'] },
      { type: 'dateRange', column: 'nextRevision', from: '2026-01-01' },
    ];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const badge = screen.getByTestId('active-filter-badge');
    expect(badge.textContent).toBe('3');
  });

  it('14. search + 2 column filters → badge shows 3', async () => {
    const filters: ColumnFilter[] = [
      { type: 'checklist', column: 'city', values: ['Prague'] },
      { type: 'dateRange', column: 'nextRevision', from: '2026-01-01' },
    ];
    seedGridLocal('columnFilters', filters);
    seedSessionFilter('search', 'foo');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const badge = screen.getByTestId('active-filter-badge');
    expect(badge.textContent).toBe('3');
  });

  // ── 6. clear all ─────────────────────────────────────────────────────────────

  it('15. clear all removes column filters from request', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Prague'] }];
    seedGridLocal('columnFilters', filters);
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());

    const clearBtn = screen.getByTestId('clear-all-btn');
    await act(async () => { clearBtn.click(); });

    await waitFor(() => {
      const cf = lastListCall().columnFilters as ColumnFilter[] | undefined;
      expect(!cf || cf.length === 0).toBe(true);
    });
  });

  it('16. clear all also clears search (combined reset)', async () => {
    const filters: ColumnFilter[] = [{ type: 'checklist', column: 'city', values: ['Prague'] }];
    seedGridLocal('columnFilters', filters);
    seedSessionFilter('search', 'foo');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());

    const clearBtn = screen.getByTestId('clear-all-btn');
    await act(async () => { clearBtn.click(); });

    await waitFor(() => {
      const req = lastListCall();
      const cf = req.columnFilters as ColumnFilter[] | undefined;
      expect(!cf || cf.length === 0).toBe(true);
      expect(req.search ?? '').toBe('');
    });
  });

  // ── 7. Legacy stale storage ──────────────────────────────────────────────────

  it('17. stale geocodeFilter in session storage → no crash, does not affect active filter count', async () => {
    // Seed legacy key that will be ignored after Phase 6B removal
    seedSessionFilter('geocodeFilter', 'failed');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    // Must not crash and legacy filter should not contribute to activeFilterCount
    // (after Phase 6B removal, geocodeFilter is no longer a counted filter)
    expect(screen.queryByTestId('clear-all-btn')).not.toBeInTheDocument();
  });

  it('18. stale typeFilter in session storage → no crash, does not affect active filter count', async () => {
    seedSessionFilter('typeFilter', 'company');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    expect(screen.queryByTestId('clear-all-btn')).not.toBeInTheDocument();
  });

  // ── 8. distinctContext contains current request context ──────────────────────

  it('19. revisionFilter=overdue → distinctContext has hasOverdue=true', async () => {
    seedSessionFilter('revisionFilter', 'overdue');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const ctx = lastTableProps.distinctContext as Record<string, unknown>;
    expect(ctx.hasOverdue).toBe(true);
  });

  it('20. search=hello → distinctContext has search=hello', async () => {
    seedSessionFilter('search', 'hello');
    render(<Customers />);
    await waitFor(() => expect(mockListCustomersExtended).toHaveBeenCalled());
    const ctx = lastTableProps.distinctContext as Record<string, unknown>;
    expect(ctx.search).toBe('hello');
  });
});
