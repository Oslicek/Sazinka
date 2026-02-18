import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CountriesManager } from './CountriesManager';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) return `${key}:${JSON.stringify(opts)}`;
      return key;
    },
    i18n: { language: 'cs' },
  }),
}));

const mockRequest = vi.fn();
vi.mock('../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const store = { isConnected: true, request: mockRequest, error: null };
    return selector ? selector(store) : store;
  }),
}));

vi.mock('@/utils/auth', () => ({ getToken: () => 'test-token' }));
vi.mock('@shared/messages', () => ({ createRequest: vi.fn((token, payload) => ({ token, payload })) }));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_COUNTRIES = [
  { code: 'CZ', alpha3: 'CZE', nameEn: 'Czechia', nameCs: 'Česko', nameSk: 'Česko', hasMapCoverage: true, valhallaRegion: 'europe', nominatimPriority: 10, isSupported: true, sortOrder: 10 },
  { code: 'SK', alpha3: 'SVK', nameEn: 'Slovakia', nameCs: 'Slovensko', nameSk: 'Slovensko', hasMapCoverage: true, valhallaRegion: 'europe', nominatimPriority: 20, isSupported: true, sortOrder: 20 },
  { code: 'DE', alpha3: 'DEU', nameEn: 'Germany', nameCs: 'Německo', nameSk: 'Nemecko', hasMapCoverage: false, valhallaRegion: null, nominatimPriority: 999, isSupported: false, sortOrder: 999 },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CountriesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section title and sync button', () => {
    render(<CountriesManager />);
    expect(screen.getByText('countries_title')).toBeTruthy();
    expect(screen.getByText('countries_sync_btn')).toBeTruthy();
  });

  it('shows a load button before data is loaded', () => {
    render(<CountriesManager />);
    expect(screen.getByText('countries_load_btn')).toBeTruthy();
  });

  it('loads and displays countries when load button is clicked', async () => {
    mockRequest.mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => {
      expect(screen.getByText('Česko')).toBeTruthy();
      expect(screen.getByText('Slovensko')).toBeTruthy();
      expect(screen.getByText('Německo')).toBeTruthy();
    });
  });

  it('hides the load button after data is loaded', async () => {
    mockRequest.mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => expect(screen.queryByText('countries_load_btn')).toBeNull());
  });

  it('filters countries by search query', async () => {
    mockRequest.mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => expect(screen.getByText('Česko')).toBeTruthy());

    const searchInput = screen.getByPlaceholderText('countries_search_placeholder');
    fireEvent.change(searchInput, { target: { value: 'česko' } });

    expect(screen.getByText('Česko')).toBeTruthy();
    expect(screen.queryByText('Slovensko')).toBeNull();
    expect(screen.queryByText('Německo')).toBeNull();
  });

  it('filters by country code', async () => {
    mockRequest.mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => expect(screen.getByText('Česko')).toBeTruthy());

    const searchInput = screen.getByPlaceholderText('countries_search_placeholder');
    // "de" matches DE code and "Německo" name, but not CZ or SK
    fireEvent.change(searchInput, { target: { value: 'de' } });

    expect(screen.getByText('Německo')).toBeTruthy();
    expect(screen.queryByText('Slovensko')).toBeNull();
  });

  it('shows empty state when no countries match search', async () => {
    mockRequest.mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => expect(screen.getByText('Česko')).toBeTruthy());

    const searchInput = screen.getByPlaceholderText('countries_search_placeholder');
    fireEvent.change(searchInput, { target: { value: 'xxxxxxxxxx' } });

    expect(screen.getByText('countries_empty')).toBeTruthy();
  });

  it('calls sync endpoint when sync button is clicked', async () => {
    mockRequest
      .mockResolvedValueOnce({ synced: 212, added: 210, updated: 2 })
      .mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_sync_btn'));
    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.admin.countries.sync',
        expect.anything()
      );
    });
  });

  it('shows sync result after successful sync', async () => {
    mockRequest
      .mockResolvedValueOnce({ synced: 212, added: 210, updated: 2 })
      .mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_sync_btn'));
    await waitFor(() => {
      expect(screen.getByText(/countries_sync_result/)).toBeTruthy();
    });
  });

  it('shows error message when load fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('NATS error'));
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => {
      expect(screen.getByText('countries_error_load')).toBeTruthy();
    });
  });

  it('displays country codes in the table', async () => {
    mockRequest.mockResolvedValueOnce({ items: MOCK_COUNTRIES });
    render(<CountriesManager />);
    fireEvent.click(screen.getByText('countries_load_btn'));
    await waitFor(() => {
      expect(screen.getByText('CZ')).toBeTruthy();
      expect(screen.getByText('SK')).toBeTruthy();
      expect(screen.getByText('DE')).toBeTruthy();
    });
  });
});
