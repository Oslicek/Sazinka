/**
 * Phase 1C (RED → GREEN) — Migrate customers.filters profile.
 *
 * Verifies that sortBy/sortOrder are removed from the session profile,
 * stale session keys are ignored, URL sort params are no longer synced,
 * and remaining filter persistence is unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { customersProfile } from '@/persistence/profiles/customersProfile';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { CUSTOMERS_PROFILE_ID } from '@/persistence/profiles/customersProfile';
import { DEFAULT_SORT_MODEL } from '@/lib/customerColumns';

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
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => mockSearchParams),
  useNavigate: vi.fn(() => mockNavigate),
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
    const state = { user: { id: 'test-user-1' } };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/services/customerService', () => ({
  listCustomersExtended: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getCustomerSummary: vi.fn().mockResolvedValue(null),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
  updateCustomer: vi.fn(),
}));

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
import * as customerService from '@/services/customerService';

const USER_ID = 'test-user-1';
// NOTE: USER_ID is declared before vi.mock hoisting executes at runtime,
// but the mock factory captures it by closure — this is safe in Vitest.

function sessionKey(controlId: string) {
  return makeKey({ userId: USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId });
}

function seedSession(controlId: string, value: unknown) {
  sessionStorage.setItem(sessionKey(controlId), JSON.stringify(makeEnvelope(value, 'session')));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 1C: customers.filters profile migration', () => {
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

  // Profile shape

  it('1. customersProfile.controls does NOT contain sortBy', () => {
    const ids = customersProfile.controls.map((c) => c.controlId);
    expect(ids).not.toContain('sortBy');
  });

  it('2. customersProfile.controls does NOT contain sortOrder', () => {
    const ids = customersProfile.controls.map((c) => c.controlId);
    expect(ids).not.toContain('sortOrder');
  });

  it('3. customersProfile.controls contains exactly 5 controls (geocodeFilter/typeFilter removed Phase 6B)', () => {
    const ids = customersProfile.controls.map((c) => c.controlId).sort();
    expect(ids).toHaveLength(5);
    expect(ids).toContain('search');
    expect(ids).toContain('viewMode');
    expect(ids).toContain('revisionFilter');
    expect(ids).toContain('selectedCustomerId');
    expect(ids).toContain('isAdvancedFiltersOpen');
    expect(ids).not.toContain('geocodeFilter');
    expect(ids).not.toContain('typeFilter');
  });

  // Backward compat — stale session keys ignored

  it('4. legacy sortBy/sortOrder keys in session → page mounts without crash', async () => {
    seedSession('sortBy', 'city');
    seedSession('sortOrder', 'desc');
    expect(() => render(<Customers />)).not.toThrow();
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());


  });

  it('5. legacy sortBy=city in session → request uses sortModel from grid profile (DEFAULT), NOT legacy city', async () => {
    seedSession('sortBy', 'city');
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).not.toHaveProperty('sortBy');
    expect(call).not.toHaveProperty('sortOrder');
    expect(call.sortModel).toEqual(DEFAULT_SORT_MODEL);


  });

  // URL sort params no longer synced

  it('6. URL sortBy/sortOrder params → request uses DEFAULT sortModel (no legacy fields)', async () => {
    mockSearchParams.sortBy = 'city';
    mockSearchParams.sortOrder = 'desc';
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).not.toHaveProperty('sortBy');
    expect(call.sortModel).toEqual(DEFAULT_SORT_MODEL);


  });

  it('7. after mount with URL sort params, session storage is NOT written with sortBy/sortOrder', async () => {
    mockSearchParams.sortBy = 'city';
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const sortByKey = sessionKey('sortBy');
    expect(sessionStorage.getItem(sortByKey)).toBeNull();


  });

  // Remaining filter persistence unaffected (via UPP seeding)

  it('8. search hydrates from session storage', async () => {
    seedSession('search', 'test-company');
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.search).toBe('test-company');


  });

  it('9. stale geocodeFilter in session storage → ignored, no crash, no geocodeStatus in request', async () => {
    seedSession('geocodeFilter', 'failed');
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // geocodeFilter is no longer a control — stale value should be ignored
    expect(call.geocodeStatus).toBeUndefined();


  });

  it('10. revisionFilter=overdue hydrates from session storage', async () => {
    seedSession('revisionFilter', 'overdue');
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.hasOverdue).toBe(true);


  });

  it('11. stale typeFilter in session storage → ignored, no crash, no customerType in request', async () => {
    seedSession('typeFilter', 'company');
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // typeFilter is no longer a control — stale value should be ignored
    expect(call.customerType).toBeUndefined();


  });

  it('12. selectedCustomerId is still in the profile (not removed)', () => {
    const ids = customersProfile.controls.map((c) => c.controlId);
    expect(ids).toContain('selectedCustomerId');
  });
});

// ---------------------------------------------------------------------------
// Phase 6B — URL coupling removal
// ---------------------------------------------------------------------------

describe('Customers page — Phase 6B: URL decoupling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('6B-1. URL sortBy/sortOrder are ignored — API uses default sortModel', async () => {
    mockSearchParams.sortBy = 'city';
    mockSearchParams.sortOrder = 'desc';
    render(<Customers />);
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());
    const call = (customerService.listCustomersExtended as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.sortModel).toEqual(DEFAULT_SORT_MODEL);
    expect(call).not.toHaveProperty('sortBy');
    expect(call).not.toHaveProperty('sortOrder');


  });

  it('6B-2. URL view/geocodeStatus/revisionFilter do NOT override UPP state', async () => {
    const key = makeKey({ userId: 'test-user-1', profileId: CUSTOMERS_PROFILE_ID, controlId: 'revisionFilter' });
    sessionStorage.setItem(key, JSON.stringify(makeEnvelope('overdue', 'session')));

    mockSearchParams.revisionFilter = 'week';

    render(<Customers />);

    await waitFor(() => {
      const overdueChip = screen.getByRole('button', { name: 'filter_revision_overdue' });
      expect(overdueChip).toHaveAttribute('aria-pressed', 'true');
      const weekChip = screen.getByRole('button', { name: 'filter_revision_week' });
      expect(weekChip).toHaveAttribute('aria-pressed', 'false');
    });


  });

  it('6B-3. URL action=new → add-customer form opens (intent param preserved)', async () => {
    mockSearchParams.action = 'new';
    render(<Customers />);
    expect(screen.getByTestId('add-form')).toBeInTheDocument();
    await waitFor(() => expect(customerService.listCustomersExtended).toHaveBeenCalled());


  });
});
