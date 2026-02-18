import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CountrySelect } from './CountrySelect';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'cs' },
  }),
}));

// Mock the @sazinka/countries package
vi.mock('@sazinka/countries', () => ({
  searchCountries: vi.fn((query: string, locale: string, list: unknown[]) => {
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((c: any) =>
      (c.name?.cs ?? '').toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }),
  countries: [
    { code: 'CZ', alpha3: 'CZE', name: { en: 'Czechia', cs: 'Česko', sk: 'Česko' } },
    { code: 'SK', alpha3: 'SVK', name: { en: 'Slovakia', cs: 'Slovensko', sk: 'Slovensko' } },
    { code: 'DE', alpha3: 'DEU', name: { en: 'Germany', cs: 'Německo', sk: 'Nemecko' } },
  ],
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CountrySelect', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with placeholder when no value is selected', () => {
    render(<CountrySelect value={null} onChange={onChange} />);
    expect(screen.getByText('country_select_placeholder')).toBeTruthy();
  });

  it('renders selected country name when value is provided', () => {
    render(<CountrySelect value="CZ" onChange={onChange} />);
    expect(screen.getByText('Česko')).toBeTruthy();
  });

  it('opens dropdown when trigger is clicked', async () => {
    render(<CountrySelect value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('country_select_search')).toBeTruthy();
    });
  });

  it('shows all countries when dropdown opens', async () => {
    render(<CountrySelect value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText('Česko')).toBeTruthy();
      expect(screen.getByText('Slovensko')).toBeTruthy();
      expect(screen.getByText('Německo')).toBeTruthy();
    });
  });

  it('filters countries when typing in search', async () => {
    render(<CountrySelect value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByPlaceholderText('country_select_search')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('country_select_search'), { target: { value: 'česko' } });

    expect(screen.getByText('Česko')).toBeTruthy();
    expect(screen.queryByText('Slovensko')).toBeNull();
  });

  it('calls onChange with country code when option is selected', async () => {
    render(<CountrySelect value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Česko')).toBeTruthy());

    fireEvent.click(screen.getByText('Česko'));
    expect(onChange).toHaveBeenCalledWith('CZ');
  });

  it('closes dropdown after selection', async () => {
    render(<CountrySelect value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Česko')).toBeTruthy());

    fireEvent.click(screen.getByText('Česko'));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('country_select_search')).toBeNull();
    });
  });

  it('allows clearing the selection', () => {
    render(<CountrySelect value="CZ" onChange={onChange} clearable />);
    const clearBtn = screen.getByTitle('country_select_clear');
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not show clear button when clearable is not set', () => {
    render(<CountrySelect value="CZ" onChange={onChange} />);
    expect(screen.queryByTitle('country_select_clear')).toBeNull();
  });
});
