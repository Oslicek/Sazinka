import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerDetail } from './CustomerDetail';
import type { Customer } from '@shared/customer';

// Mock the customerService
vi.mock('../services/customerService', () => ({
  getCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
}));

// Mock the router
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({ customerId: 'test-customer-id' })),
  useNavigate: vi.fn(() => mockNavigate),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
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

// Mock the AddressMap component
vi.mock('../components/customers/AddressMap', () => ({
  AddressMap: ({ lat, lng }: { lat?: number; lng?: number }) => (
    <div data-testid="address-map" data-lat={lat} data-lng={lng}>
      Map Component
    </div>
  ),
}));

import { getCustomer } from '../services/customerService';

const mockGetCustomer = vi.mocked(getCustomer);

describe('CustomerDetail', () => {
  const mockCustomer: Customer = {
    id: 'test-customer-id',
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
    notes: 'Testovací poznámka',
    createdAt: '2026-01-26T12:00:00Z',
    updatedAt: '2026-01-26T12:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = true; // Reset to connected state
  });

  describe('Loading state', () => {
    it('should show loading indicator while fetching customer', async () => {
      // Never resolve to keep loading state
      mockGetCustomer.mockImplementation(() => new Promise(() => {}));

      render(<CustomerDetail />);

      expect(screen.getByText(/načítám/i)).toBeInTheDocument();
    });
  });

  describe('Customer display', () => {
    it('should display customer name', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText('Jan Novák')).toBeInTheDocument();
      });
    });

    it('should display customer address', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText(/Hlavní 123/)).toBeInTheDocument();
        expect(screen.getByText(/Praha/)).toBeInTheDocument();
        expect(screen.getByText(/11000/)).toBeInTheDocument();
      });
    });

    it('should display customer email', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText('jan@example.com')).toBeInTheDocument();
      });
    });

    it('should display customer phone', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText('+420 123 456 789')).toBeInTheDocument();
      });
    });

    it('should display customer notes', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText('Testovací poznámka')).toBeInTheDocument();
      });
    });

    it('should not show email section if email is not provided', async () => {
      const customerWithoutEmail = { ...mockCustomer, email: undefined };
      mockGetCustomer.mockResolvedValueOnce(customerWithoutEmail);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText('Jan Novák')).toBeInTheDocument();
      });
      
      expect(screen.queryByText('jan@example.com')).not.toBeInTheDocument();
    });

    it('should not show notes section if notes is not provided', async () => {
      const customerWithoutNotes = { ...mockCustomer, notes: undefined };
      mockGetCustomer.mockResolvedValueOnce(customerWithoutNotes);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText('Jan Novák')).toBeInTheDocument();
      });
      
      expect(screen.queryByText('Testovací poznámka')).not.toBeInTheDocument();
    });
  });

  describe('Map display', () => {
    it('should display map with coordinates when available', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        const map = screen.getByTestId('address-map');
        expect(map).toBeInTheDocument();
        expect(map).toHaveAttribute('data-lat', '50.0755');
        expect(map).toHaveAttribute('data-lng', '14.4378');
      });
    });

    it('should show message when coordinates are not available', async () => {
      const customerWithoutCoords = { ...mockCustomer, lat: undefined, lng: undefined };
      mockGetCustomer.mockResolvedValueOnce(customerWithoutCoords);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText(/poloha.*není.*k dispozici/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error handling', () => {
    it('should show error message when customer fetch fails', async () => {
      mockGetCustomer.mockRejectedValueOnce(new Error('Customer not found'));

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText(/customer not found/i)).toBeInTheDocument();
      });
    });

    it('should show error when not connected to server', async () => {
      mockIsConnected = false;

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByText(/není připojení/i)).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should have a back button', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /zpět/i })).toBeInTheDocument();
      });
    });

    it('should link back to customers list', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        const backLink = screen.getByRole('link', { name: /zpět/i });
        expect(backLink).toHaveAttribute('href', '/customers');
      });
    });
  });

  describe('API calls', () => {
    it('should call getCustomer with correct parameters', async () => {
      mockGetCustomer.mockResolvedValueOnce(mockCustomer);

      render(<CustomerDetail />);

      await waitFor(() => {
        expect(mockGetCustomer).toHaveBeenCalledWith(
          expect.any(String), // userId
          'test-customer-id'
        );
      });
    });
  });
});
