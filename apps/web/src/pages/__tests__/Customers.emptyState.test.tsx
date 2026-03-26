/**
 * Phase 6C — Customers empty-state & clear-filters UX tests.
 *
 * When filters produce 0 results the page should guide the user to reset filters/sort.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { CUSTOMERS_PROFILE_ID } from '@/persistence/profiles/customersProfile';
import { CUSTOMERS_GRID_PROFILE_ID } from '@/persistence/profiles/customersGridProfile';

// ---------------------------------------------------------------------------
// Router mock
// ---------------------------------------------------------------------------

const mockSearchParams: Record<string, string | boolean> = {};
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => mockSearchParams),
  useNavigate: vi.fn(() => mockNavigate),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Service mocks — no customers by default
// ---------------------------------------------------------------------------

const mockListCustomers = vi.fn().mockResolvedValue({ items: [], total: 0 });

vi.mock('@/services/customerService', () => ({
  listCustomersExtended: (...args: unknown[]) => mockListCustomers(...args),
  getCustomerSummary: vi.fn().mockResolvedValue(null),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
  updateCustomer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Component mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/customers/AddCustomerForm', () => ({
  AddCustomerForm: () => <div data-testid="add-form" />,
}));

vi.mock('@/components/customers/CustomerTable', () => ({
  CustomerTable: ({ customers }: { customers: unknown[] }) => (
    <div data-testid="customer-table">{customers.length} customers</div>
  ),
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
      {panels.map((p: { id: string; content: React.ReactNode }) => (
        <div key={p.id}>{p.content}</div>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { Customers } from '../Customers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'test-user-1';

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

function seedSession(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

function seedLocal(profileId: string, controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId, controlId });
  localStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'local')));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Customers page — Phase 6C: empty state UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    mockListCustomers.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('6C-1. 0 results with active filters → shows "no customers match" message', async () => {
    seedSession('search', 'xyz-no-match');
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByText('no_customers_match')).toBeInTheDocument();
    });
  });

  it('6C-2. 0 results with active filters → shows "Clear filters" button', async () => {
    seedSession('revisionFilter', 'overdue');
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-clear-filters-btn')).toBeInTheDocument();
    });
  });

  it('6C-3. Clicking "Clear filters" in empty state resets all filter controls', async () => {
    seedSession('search', 'xyz');
    seedSession('revisionFilter', 'overdue');
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-clear-filters-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('empty-clear-filters-btn'));
    await waitFor(() => {
      const chip = screen.getByRole('button', { name: 'filter_revision_overdue' });
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('6C-4. After clearing filters, listCustomersExtended is re-called without the week filter', async () => {
    seedSession('revisionFilter', 'week');
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-clear-filters-btn')).toBeInTheDocument();
    });
    // Capture the call with the week filter to verify the API shape first
    const callWithFilter = mockListCustomers.mock.calls[mockListCustomers.mock.calls.length - 1][0];
    expect(callWithFilter).toHaveProperty('nextRevisionWithinDays', 7);

    const callsBefore = mockListCustomers.mock.calls.length;
    fireEvent.click(screen.getByTestId('empty-clear-filters-btn'));
    await waitFor(() => {
      expect(mockListCustomers.mock.calls.length).toBeGreaterThan(callsBefore);
      const lastCall = mockListCustomers.mock.calls[mockListCustomers.mock.calls.length - 1][0];
      expect(lastCall).not.toHaveProperty('nextRevisionWithinDays');
      expect(lastCall).not.toHaveProperty('hasOverdue');
    });
  });

  it('6C-5. 0 results with NO filters and default sort → shows "no customers yet" message', async () => {
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByText('no_customers_yet')).toBeInTheDocument();
    });
  });

  it('6C-6. "Reset sort" button shown when sortModel differs from default', async () => {
    seedLocal(CUSTOMERS_GRID_PROFILE_ID, 'sortModel', [{ column: 'city', direction: 'asc' }]);
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-reset-sort-btn')).toBeInTheDocument();
    });
  });

  it('6C-7. Clicking "Reset sort" restores the default sort model', async () => {
    seedLocal(CUSTOMERS_GRID_PROFILE_ID, 'sortModel', [{ column: 'city', direction: 'asc' }]);
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-reset-sort-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('empty-reset-sort-btn'));
    await waitFor(() => {
      // After reset the button should no longer be shown (sort is back to default)
      expect(screen.queryByTestId('empty-reset-sort-btn')).not.toBeInTheDocument();
    });
  });
});
