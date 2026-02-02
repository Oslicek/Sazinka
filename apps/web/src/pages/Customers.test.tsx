import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Customers } from './Customers';
import type { Customer } from '@shared/customer';

// Mock the customerService
vi.mock('../services/customerService', () => ({
  createCustomer: vi.fn(),
  listCustomers: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
}));

// Mock the router
vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
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

// Mock the AddCustomerForm component
vi.mock('../components/customers/AddCustomerForm', () => ({
  AddCustomerForm: ({ onSubmit, onCancel }: { onSubmit: () => void; onCancel: () => void }) => (
    <div data-testid="add-customer-form">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { listCustomers } from '../services/customerService';

const mockListCustomers = vi.mocked(listCustomers);

describe('Customers', () => {
  const mockCustomers: Customer[] = [
    {
      id: 'customer-1',
      userId: 'user-123',
      name: 'Jan Novák',
      email: 'jan@example.com',
      phone: '+420 123 456 789',
      street: 'Hlavní 123',
      city: 'Praha',
      postalCode: '11000',
      country: 'CZ',
      lat: 50.0755,
      lng: 14.4378,
      geocodeStatus: 'success',
      createdAt: '2026-01-26T12:00:00Z',
      updatedAt: '2026-01-26T12:00:00Z',
    },
    {
      id: 'customer-2',
      userId: 'user-123',
      name: 'Marie Svobodová',
      email: 'marie@example.com',
      phone: '+420 987 654 321',
      street: 'Vedlejší 456',
      city: 'Brno',
      postalCode: '60200',
      country: 'CZ',
      geocodeStatus: 'pending',
      createdAt: '2026-01-26T13:00:00Z',
      updatedAt: '2026-01-26T13:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = true;
  });

  describe('Customer list display', () => {
    it('should display customer names', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: mockCustomers, total: 2 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('Jan Novák')).toBeInTheDocument();
        expect(screen.getByText('Marie Svobodová')).toBeInTheDocument();
      });
    });

    it('should display customer addresses', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: mockCustomers, total: 2 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText(/Hlavní 123/)).toBeInTheDocument();
        expect(screen.getByText(/Praha/)).toBeInTheDocument();
      });
    });
  });

  describe('Navigation to customer detail', () => {
    it('should render customer cards as links', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: mockCustomers, total: 2 });

      render(<Customers />);

      await waitFor(() => {
        const links = screen.getAllByTestId('customer-link');
        expect(links.length).toBe(2);
      });
    });

    it('should link to correct customer detail page', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: mockCustomers, total: 2 });

      render(<Customers />);

      await waitFor(() => {
        const links = screen.getAllByTestId('customer-link');
        expect(links[0]).toHaveAttribute('href', '/customers/customer-1');
        expect(links[1]).toHaveAttribute('href', '/customers/customer-2');
      });
    });

    it('should make entire customer card clickable', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: mockCustomers, total: 2 });

      render(<Customers />);

      await waitFor(() => {
        // The link should contain the customer name
        const link = screen.getAllByTestId('customer-link')[0];
        expect(link).toContainElement(screen.getByText('Jan Novák'));
      });
    });
  });

  describe('Loading state', () => {
    it('should show loading indicator while fetching customers', async () => {
      mockListCustomers.mockImplementation(() => new Promise(() => {}));

      render(<Customers />);

      expect(screen.getByText(/načítám/i)).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should show empty message when no customers exist', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: [], total: 0 });

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText(/nemáte žádné zákazníky/i)).toBeInTheDocument();
      });
    });
  });

  describe('Search functionality', () => {
    it('should filter customers by name', async () => {
      mockListCustomers.mockResolvedValueOnce({ items: mockCustomers, total: 2 });
      const user = userEvent.setup();

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText('Jan Novák')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/hledat/i);
      await user.type(searchInput, 'Marie');

      expect(screen.queryByText('Jan Novák')).not.toBeInTheDocument();
      expect(screen.getByText('Marie Svobodová')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should show error when not connected', async () => {
      mockIsConnected = false;

      render(<Customers />);

      await waitFor(() => {
        expect(screen.getByText(/není připojení/i)).toBeInTheDocument();
      });
    });
  });
});
