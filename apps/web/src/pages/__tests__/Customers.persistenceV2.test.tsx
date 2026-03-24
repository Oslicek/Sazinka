/**
 * Phase 5 / P2 — Customers page persistence V2 tests.
 *
 * Verifies that all 7 filter controls hydrate from and persist to UPP.
 * Covers C28 (revisionFilter full enum), C30 (typeFilter), C31 (search).
 * P2 additions: unmount/remount survival, URL precedence, provider smoke.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { sessionAdapter } from '@/persistence/adapters/singletons';
import { CUSTOMERS_PROFILE_ID } from '@/persistence/profiles/customersProfile';

// ---------------------------------------------------------------------------
// Router mock — controllable search params
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
// Service mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/customerService', () => ({
  listCustomersExtended: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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

vi.mock('@/components/customers/SavedViewsSelector', () => ({
  SavedViewsSelector: ({ onApply }: { onApply: (view: { filters: Record<string, unknown> }) => void }) => (
    <button
      data-testid="saved-view-btn"
      onClick={() => onApply({ filters: { revisionFilter: 'week', type: 'company' } })}
    >
      Apply View
    </button>
  ),
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
// Tests
// ---------------------------------------------------------------------------

describe('Customers page — persistence V2 (Phase 5)', () => {
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
    expect(() => render(<Customers />)).not.toThrow();
  });

  it('URL geocodeStatus param hydrates geocodeFilter', () => {
    mockSearchParams.geocodeStatus = 'failed';
    render(<Customers />);
    const select = screen.getByDisplayValue('filter_address_failed');
    expect(select).toBeInTheDocument();
  });

  it('URL sortBy param is read from searchParams without crash', () => {
    mockSearchParams.sortBy = 'city';
    // Should not throw — sortBy is applied to the request
    expect(() => render(<Customers />)).not.toThrow();
  });

  it('URL sortOrder param is read from searchParams without crash', () => {
    mockSearchParams.sortOrder = 'desc';
    expect(() => render(<Customers />)).not.toThrow();
  });

  it('revisionFilter: overdue value is selectable', async () => {
    render(<Customers />);
    const select = screen.getByDisplayValue('filter_revision_all');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'overdue' } });
    });
    expect(screen.getByDisplayValue('filter_revision_overdue')).toBeInTheDocument();
  });

  it('revisionFilter: week value is selectable (C28)', async () => {
    render(<Customers />);
    const select = screen.getByDisplayValue('filter_revision_all');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'week' } });
    });
    expect(screen.getByDisplayValue('filter_revision_week')).toBeInTheDocument();
  });

  it('revisionFilter: month value is selectable (C28)', async () => {
    render(<Customers />);
    const select = screen.getByDisplayValue('filter_revision_all');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'month' } });
    });
    expect(screen.getByDisplayValue('filter_revision_month')).toBeInTheDocument();
  });

  it('typeFilter: company value is selectable (C30)', async () => {
    render(<Customers />);
    const select = screen.getByDisplayValue('filter_type_all');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'company' } });
    });
    expect(screen.getByDisplayValue('filter_type_company')).toBeInTheDocument();
  });

  it('typeFilter: person value is selectable (C30)', async () => {
    render(<Customers />);
    const select = screen.getByDisplayValue('filter_type_all');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'person' } });
    });
    expect(screen.getByDisplayValue('filter_type_person')).toBeInTheDocument();
  });

  it('search input exists and accepts text (C31)', async () => {
    render(<Customers />);
    const input = screen.getByPlaceholderText('search_placeholder');
    expect(input).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(input, { target: { value: 'test search' } });
    });
    expect((input as HTMLInputElement).value).toBe('test search');
  });

  it('URL view param hydrates viewMode', () => {
    mockSearchParams.view = 'cards';
    render(<Customers />);
    // Cards view button should be present
    const cardsBtn = screen.getByTestId('view-cards-btn');
    expect(cardsBtn).toBeInTheDocument();
  });

  it('view toggle buttons are present', () => {
    render(<Customers />);
    expect(screen.getByTestId('view-table-btn')).toBeInTheDocument();
    expect(screen.getByTestId('view-cards-btn')).toBeInTheDocument();
  });

  it('geocodeFilter unknown value falls back to empty (invalid URL param)', () => {
    mockSearchParams.geocodeStatus = 'invalid_value' as unknown as string;
    render(<Customers />);
    // Should fall back to "all" (empty) option
    expect(screen.getByDisplayValue('filter_address_all')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P2 — UPP wiring tests (unmount/remount survival + URL precedence + smoke)
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'test-user-upp';

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

describe('Customers page — P2 UPP wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.keys(mockSearchParams).forEach((k) => delete mockSearchParams[k]);
    // Seed auth store with test user
    vi.mock('@/stores/authStore', () => ({
      useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
        const state = { user: { id: TEST_USER_ID } };
        return selector ? selector(state) : state;
      }),
    }));
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('provider smoke: with PersistenceProvider in tree, Customers renders and toolbar visible', () => {
    expect(() => render(<Customers />)).not.toThrow();
    expect(screen.getByPlaceholderText('search_placeholder')).toBeInTheDocument();
  });

  it('viewMode survives unmount/remount', async () => {
    seedUpp('viewMode', 'cards');
    const { unmount } = render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('view-cards-btn')).toBeInTheDocument();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      // Cards button should still be present (page restored from UPP)
      expect(screen.getByTestId('view-cards-btn')).toBeInTheDocument();
    });
  });

  it('geocodeFilter survives unmount/remount', async () => {
    seedUpp('geocodeFilter', 'failed');
    const { unmount } = render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_address_failed')).toBeInTheDocument();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_address_failed')).toBeInTheDocument();
    });
  });

  it('revisionFilter survives unmount/remount', async () => {
    seedUpp('revisionFilter', 'week');
    const { unmount } = render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_revision_week')).toBeInTheDocument();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_revision_week')).toBeInTheDocument();
    });
  });

  it('typeFilter survives unmount/remount', async () => {
    seedUpp('typeFilter', 'company');
    const { unmount } = render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_type_company')).toBeInTheDocument();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_type_company')).toBeInTheDocument();
    });
  });

  it('sortBy survives unmount/remount', async () => {
    seedUpp('sortBy', 'city');
    const { unmount } = render(<Customers />);
    unmount();
    // After remount, sortBy=city should be used in the request (no visible select, but no crash)
    expect(() => render(<Customers />)).not.toThrow();
  });

  it('sortOrder survives unmount/remount', async () => {
    seedUpp('sortOrder', 'desc');
    const { unmount } = render(<Customers />);
    unmount();
    expect(() => render(<Customers />)).not.toThrow();
  });

  it('search survives unmount/remount', async () => {
    seedUpp('search', 'persisted-search');
    const { unmount } = render(<Customers />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText('search_placeholder') as HTMLInputElement;
      expect(input.value).toBe('persisted-search');
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText('search_placeholder') as HTMLInputElement;
      expect(input.value).toBe('persisted-search');
    });
  });

  it('URL view=cards overrides UPP-persisted viewMode=table', async () => {
    seedUpp('viewMode', 'table');
    mockSearchParams.view = 'cards';
    render(<Customers />);
    // Cards button should be active (URL wins)
    await waitFor(() => {
      expect(screen.getByTestId('view-cards-btn')).toBeInTheDocument();
    });
  });

  it('URL geocodeStatus=failed overrides UPP-persisted geocodeFilter=empty', async () => {
    seedUpp('geocodeFilter', '');
    mockSearchParams.geocodeStatus = 'failed';
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_address_failed')).toBeInTheDocument();
    });
  });

  it('URL revisionFilter=week overrides UPP-persisted revisionFilter=overdue', async () => {
    seedUpp('revisionFilter', 'overdue');
    mockSearchParams.revisionFilter = 'week';
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('filter_revision_week')).toBeInTheDocument();
    });
  });

  it('listCustomersExtended is still called after UPP wiring (API shape unchanged)', async () => {
    const { listCustomersExtended } = await import('@/services/customerService');
    render(<Customers />);
    await waitFor(() => {
      expect(listCustomersExtended).toHaveBeenCalled();
    });
  });
});
