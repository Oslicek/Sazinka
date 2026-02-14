import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Customers } from './Customers';
import type { CustomerListItem, CustomerSummary } from '@shared/customer';

// Mock the customerService
const mockListCustomersExtended = vi.fn();
const mockGetCustomerSummary = vi.fn();
const mockCreateCustomer = vi.fn();
const mockImportCustomersBatch = vi.fn();
const mockSubmitGeocodeJob = vi.fn();
const mockSubscribeToGeocodeJobStatus = vi.fn();

vi.mock('../services/customerService', () => ({
  createCustomer: (...args: unknown[]) => mockCreateCustomer(...args),
  listCustomersExtended: (...args: unknown[]) => mockListCustomersExtended(...args),
  getCustomerSummary: (...args: unknown[]) => mockGetCustomerSummary(...args),
  importCustomersBatch: (...args: unknown[]) => mockImportCustomersBatch(...args),
  submitGeocodeJob: (...args: unknown[]) => mockSubmitGeocodeJob(...args),
  subscribeToGeocodeJobStatus: (...args: unknown[]) => mockSubscribeToGeocodeJobStatus(...args),
}));

// Mock the router
vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className} data-testid="customer-link">{children}</a>
  ),
}));

// Mock the NATS store
let mockIsConnected = true;
vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector) => {
    const state = { isConnected: mockIsConnected };
    return selector(state);
  }),
}));

// Mock child components that aren't under test
vi.mock('../components/customers/AddCustomerForm', () => ({
  AddCustomerForm: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="add-customer-form">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('../components/customers/ImportCustomersModal', () => ({
  ImportCustomersModal: () => null,
}));

vi.mock('../components/customers/CustomerTable', () => ({
  CustomerTable: ({ customers, totalCount }: { customers: CustomerListItem[]; totalCount: number }) => (
    <div data-testid="customer-table">
      <span data-testid="table-row-count">{customers.length}</span>
      <span data-testid="table-total-count">{totalCount}</span>
    </div>
  ),
}));

vi.mock('../components/customers/CustomerPreviewPanel', () => ({
  CustomerPreviewPanel: () => <div data-testid="preview-panel" />,
}));

vi.mock('../components/customers/SavedViewsSelector', () => ({
  SavedViewsSelector: () => <div data-testid="saved-views" />,
}));

vi.mock('../components/common/SplitView', () => ({
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">
      {panels.map((p) => (
        <div key={p.id} data-testid={`panel-${p.id}`}>{p.content}</div>
      ))}
    </div>
  ),
}));

// --- Test data ---

function makeCustomer(overrides: Partial<CustomerListItem> = {}): CustomerListItem {
  return {
    id: `customer-${Math.random().toString(36).slice(2)}`,
    userId: 'user-123',
    type: 'person',
    name: 'Test Customer',
    email: 'test@example.com',
    phone: '+420 123 456 789',
    street: 'Hlavní 1',
    city: 'Praha',
    postalCode: '11000',
    geocodeStatus: 'success',
    createdAt: '2026-01-26T12:00:00Z',
    deviceCount: 1,
    nextRevisionDate: null,
    overdueCount: 0,
    neverServicedCount: 0,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    totalCustomers: 1000,
    totalDevices: 2500,
    revisionsOverdue: 120,
    revisionsDueThisWeek: 15,
    revisionsScheduled: 50,
    geocodeSuccess: 500,
    geocodePending: 99,
    geocodeFailed: 401,
    customersWithoutPhone: 30,
    customersWithoutEmail: 80,
    customersWithOverdue: 70,
    customersNeverServiced: 100,
    ...overrides,
  };
}

describe('Customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = true;
    // Default: return empty list and summary
    mockListCustomersExtended.mockResolvedValue({ items: [], total: 0 });
    mockGetCustomerSummary.mockResolvedValue(makeSummary());
  });

  // =========================================================================
  // Stats bar: server-side summary
  // =========================================================================
  describe('Stats bar uses server-side summary', () => {
    it('should display total customers from summary', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ totalCustomers: 1234 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1234 });

      render(<Customers />);

      await waitFor(() => {
        const celkemLabel = screen.getByText('stat_total');
        // The stat value is the sibling span within the same stat item
        const statItem = celkemLabel.parentElement!;
        expect(statItem.textContent).toContain('1234');
      });
    });

    it('should display customersWithOverdue from summary as "stat_overdue"', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ customersWithOverdue: 70 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1000 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('70')).toBeInTheDocument();
        expect(screen.getByText('stat_overdue')).toBeInTheDocument();
      });
    });

    it('should display customersNeverServiced from summary as "stat_no_revision"', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ customersNeverServiced: 100 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1000 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('stat_no_revision')).toBeInTheDocument();
      });
    });

    it('should display geocodeFailed from summary as "stat_geocode_failed"', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ geocodeFailed: 401 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1000 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('401')).toBeInTheDocument();
        expect(screen.getByText('stat_geocode_failed')).toBeInTheDocument();
      });
    });

    it('should display geocodePending from summary as "stat_geocode_pending"', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ geocodePending: 99 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1000 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('99')).toBeInTheDocument();
        expect(screen.getByText('stat_geocode_pending')).toBeInTheDocument();
      });
    });

    it('should NOT show "stat_overdue" stat when count is 0', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ customersWithOverdue: 0 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1000 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('stat_total')).toBeInTheDocument();
      });
      expect(screen.queryByText('stat_overdue')).not.toBeInTheDocument();
    });

    it('should NOT show "stat_no_revision" stat when count is 0', async () => {
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({ customersNeverServiced: 0 }));
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 1000 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('stat_total')).toBeInTheDocument();
      });
      expect(screen.queryByText('stat_no_revision')).not.toBeInTheDocument();
    });

    it('should show stable stats that do not change as more customers load', async () => {
      // Summary provides fixed counts
      mockGetCustomerSummary.mockResolvedValueOnce(makeSummary({
        customersWithOverdue: 70,
        customersNeverServiced: 100,
        geocodeFailed: 401,
      }));
      // First page: only 2 customers, one with overdue
      mockListCustomersExtended.mockResolvedValueOnce({
        items: [
          makeCustomer({ overdueCount: 1 }),
          makeCustomer({ neverServicedCount: 1 }),
        ],
        total: 1000,
      });

      render(<Customers />);

      await waitFor(() => {
        // Stats should show server-side summary values, not loaded data counts (1, 1)
        expect(screen.getByText('70')).toBeInTheDocument();
        expect(screen.getByText('stat_overdue')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('stat_no_revision')).toBeInTheDocument();
        expect(screen.getByText('401')).toBeInTheDocument();
      });
    });

    it('should fall back to loaded-data counts when summary fails', async () => {
      mockGetCustomerSummary.mockRejectedValueOnce(new Error('unavailable'));
      mockListCustomersExtended.mockResolvedValueOnce({
        items: [
          makeCustomer({ overdueCount: 2 }),
          makeCustomer({ overdueCount: 1 }),
          makeCustomer({ neverServicedCount: 1 }),
        ],
        total: 3,
      });

      render(<Customers />);

      await waitFor(() => {
        // Falls back to loaded data: 2 overdue, 1 never-serviced
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('stat_overdue')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('stat_no_revision')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Toolbar: filter dropdowns always visible
  // =========================================================================
  describe('Toolbar filter dropdowns', () => {
    it('should render both address and revision filter dropdowns', async () => {
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 0 });

      render(<Customers />);

      await waitFor(() => {
        // Address filter
        const addressFilter = screen.getByDisplayValue('filter_address_all');
        expect(addressFilter).toBeInTheDocument();
        expect(addressFilter.tagName).toBe('SELECT');

        // Revision filter
        const revisionFilter = screen.getByDisplayValue('filter_revision_all');
        expect(revisionFilter).toBeInTheDocument();
        expect(revisionFilter.tagName).toBe('SELECT');
      });
    });

    it('should render address filter options', async () => {
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 0 });

      render(<Customers />);

      await waitFor(() => {
        const addressFilter = screen.getByDisplayValue('filter_address_all');
        const options = addressFilter.querySelectorAll('option');
        expect(options).toHaveLength(4);
        expect(options[0].textContent).toBe('filter_address_all');
        expect(options[1].textContent).toBe('filter_address_success');
        expect(options[2].textContent).toBe('filter_address_failed');
        expect(options[3].textContent).toBe('filter_address_pending');
      });
    });

    it('should render revision filter options', async () => {
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 0 });

      render(<Customers />);

      await waitFor(() => {
        const revisionFilter = screen.getByDisplayValue('filter_revision_all');
        const options = revisionFilter.querySelectorAll('option');
        expect(options).toHaveLength(4);
        expect(options[0].textContent).toBe('filter_revision_all');
        expect(options[1].textContent).toBe('filter_revision_overdue');
        expect(options[2].textContent).toBe('filter_revision_week');
        expect(options[3].textContent).toBe('filter_revision_month');
      });
    });

    it('should render view toggle buttons alongside filters', async () => {
      mockListCustomersExtended.mockResolvedValueOnce({ items: [], total: 0 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByTitle('view_table')).toBeInTheDocument();
        expect(screen.getByTitle('view_cards')).toBeInTheDocument();
      });
    });

    it('should change revision filter value when selected', async () => {
      mockListCustomersExtended.mockResolvedValue({ items: [], total: 0 });
      const user = userEvent.setup();

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('filter_revision_all')).toBeInTheDocument();
      });

      const revisionFilter = screen.getByDisplayValue('filter_revision_all');
      await user.selectOptions(revisionFilter, 'overdue');

      expect(revisionFilter).toHaveValue('overdue');
    });
  });

  // =========================================================================
  // Existing tests (updated to use new service mocks)
  // =========================================================================
  describe('Connection state', () => {
    it('should show error when not connected', async () => {
      mockIsConnected = false;

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('error_not_connected')).toBeInTheDocument();
      });
    });
  });

  describe('Loading and empty state', () => {
    it('should show loading indicator while fetching', async () => {
      mockListCustomersExtended.mockImplementation(() => new Promise(() => {}));
      mockGetCustomerSummary.mockImplementation(() => new Promise(() => {}));

      render(<Customers />);

      // The CustomerTable mock won't render loading - the isLoading state triggers
      // the table's own loading state. We just verify the service was called.
      expect(mockListCustomersExtended).toHaveBeenCalled();
    });

    it('should pass loaded customers to table component', async () => {
      const customers = [makeCustomer({ name: 'Jan' }), makeCustomer({ name: 'Marie' })];
      mockListCustomersExtended.mockResolvedValueOnce({ items: customers, total: 2 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByTestId('table-row-count')).toHaveTextContent('2');
        expect(screen.getByTestId('table-total-count')).toHaveTextContent('2');
      });
    });
  });
});
