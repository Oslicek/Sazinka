/**
 * P3-1 — Customers page selectedCustomer persistence tests
 *
 * Covers:
 *  - selectedCustomerId survives unmount/remount via UPP session channel
 *  - graceful fallback when persisted customer no longer exists
 *  - multi-cycle persistence
 *
 * TDD: RED tests written before implementing UPP wiring in Customers.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { makeEnvelope, makeKey } from '../persistence/core/types';
import { CUSTOMERS_PROFILE_ID } from '../persistence/profiles/customersProfile';
import type { CustomerListItem } from '@shared/customer';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

const TEST_USER_ID = 'customers-test-user';

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../services/customerService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/customerService')>();
  return {
    ...original,
    listCustomersExtended: vi.fn(),
    getCustomerSummary: vi.fn().mockResolvedValue(null),
    getCustomer: vi.fn().mockResolvedValue(null),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    submitGeocodeJob: vi.fn(),
    subscribeToGeocodeJobStatus: vi.fn().mockReturnValue(() => {}),
  };
});

// Capture selectedId and onSelectCustomer from CustomerTable across renders
let capturedSelectedId: string | null = null;
let capturedOnSelect: ((c: CustomerListItem | null) => void) = () => {};

vi.mock('../components/customers/CustomerTable', () => ({
  CustomerTable: ({
    selectedId,
    onSelectCustomer,
  }: {
    selectedId: string | null;
    onSelectCustomer: (c: CustomerListItem | null) => void;
  }) => {
    capturedSelectedId = selectedId;
    capturedOnSelect = onSelectCustomer;
    return <div data-testid="customer-table" data-selected={selectedId ?? ''} />;
  },
}));

vi.mock('../components/customers/CustomerPreviewPanel', () => ({
  CustomerPreviewPanel: () => <div data-testid="preview-panel" />,
}));

vi.mock('../components/customers/CustomerEditDrawer', () => ({
  CustomerEditDrawer: () => null,
}));

vi.mock('../components/customers/AddCustomerForm', () => ({
  AddCustomerForm: () => null,
}));

vi.mock('../components/customers/SavedViewsSelector', () => ({
  SavedViewsSelector: () => null,
}));

vi.mock('../components/common/SplitView', () => ({
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">
      {panels.map((p) => (
        <div key={p.id}>{p.content}</div>
      ))}
    </div>
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CUSTOMER_A: CustomerListItem = {
  id: 'cust-a',
  name: 'Alice',
  city: 'Prague',
  customerType: 'company',
  geocodeStatus: 'ok',
  hasOverdue: false,
  lastRevisionDate: null,
  nextRevisionDate: null,
  phone: null,
};

const CUSTOMER_B: CustomerListItem = {
  id: 'cust-b',
  name: 'Bob',
  city: 'Brno',
  customerType: 'person',
  geocodeStatus: 'ok',
  hasOverdue: false,
  lastRevisionDate: null,
  nextRevisionDate: null,
  phone: null,
};

function makeCustomersResponse(items: CustomerListItem[]) {
  return { items, total: items.length };
}

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

import * as customerService from '../services/customerService';
import { Customers } from './Customers';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Customers page — selectedCustomer persistence (P3-1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    capturedSelectedId = null;
    capturedOnSelect = () => {};
    vi.mocked(customerService.listCustomersExtended).mockResolvedValue(
      makeCustomersResponse([CUSTOMER_A, CUSTOMER_B]),
    );
  });

  it('restores persisted customer selection on remount', async () => {
    seedUpp('selectedCustomerId', CUSTOMER_B.id);

    const { unmount } = render(<Customers />);

    await waitFor(() => {
      expect(capturedSelectedId).toBe(CUSTOMER_B.id);
    });

    unmount();

    vi.mocked(customerService.listCustomersExtended).mockResolvedValue(
      makeCustomersResponse([CUSTOMER_A, CUSTOMER_B]),
    );
    render(<Customers />);

    await waitFor(() => {
      expect(capturedSelectedId).toBe(CUSTOMER_B.id);
    });
  });

  it('multi-cycle: selection persists across two unmount/remount cycles', async () => {
    seedUpp('selectedCustomerId', CUSTOMER_A.id);

    const { unmount: u1 } = render(<Customers />);
    await waitFor(() => expect(capturedSelectedId).toBe(CUSTOMER_A.id));
    u1();

    vi.mocked(customerService.listCustomersExtended).mockResolvedValue(
      makeCustomersResponse([CUSTOMER_A, CUSTOMER_B]),
    );
    const { unmount: u2 } = render(<Customers />);
    await waitFor(() => expect(capturedSelectedId).toBe(CUSTOMER_A.id));
    u2();

    vi.mocked(customerService.listCustomersExtended).mockResolvedValue(
      makeCustomersResponse([CUSTOMER_A, CUSTOMER_B]),
    );
    render(<Customers />);
    await waitFor(() => expect(capturedSelectedId).toBe(CUSTOMER_A.id));
  });

  it('falls back gracefully when persisted customer no longer exists', async () => {
    seedUpp('selectedCustomerId', 'cust-deleted');
    vi.mocked(customerService.listCustomersExtended).mockResolvedValue(
      makeCustomersResponse([CUSTOMER_A, CUSTOMER_B]),
    );

    expect(() => render(<Customers />)).not.toThrow();

    await waitFor(() => {
      // Customers are loaded
      expect(customerService.listCustomersExtended).toHaveBeenCalled();
    });

    // No selection — deleted customer is not in the list
    expect(capturedSelectedId).toBeFalsy();
  });

  it('no selection shown when no ID was persisted', async () => {
    // No seedUpp call — empty sessionStorage
    render(<Customers />);

    await waitFor(() => {
      expect(customerService.listCustomersExtended).toHaveBeenCalled();
    });

    expect(capturedSelectedId).toBeFalsy();
  });
});
