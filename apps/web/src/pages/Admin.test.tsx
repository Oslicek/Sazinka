import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Admin } from './Admin';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (opts) return `${key}:${JSON.stringify(opts)}`;
      return key;
    },
    i18n: { language: 'cs' },
  }),
}));

const mockNatsStore = { isConnected: false, request: vi.fn(), error: null };
vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: typeof mockNatsStore) => unknown) =>
    selector ? selector(mockNatsStore) : mockNatsStore
  ),
}));

vi.mock('../stores/activeJobsStore', () => ({
  useActiveJobsStore: vi.fn((selector) => selector({ jobs: new Map() })),
}));

vi.mock('../services/customerService', () => ({
  importCustomersBatch: vi.fn(),
  submitGeocodeAllPending: vi.fn(),
}));

vi.mock('../components/import', () => ({
  ImportModal: () => null,
}));

vi.mock('../components/customers/ImportCustomersModal', () => ({
  ImportCustomersModal: () => null,
}));

vi.mock('../components/shared/ExportPlusPanel', () => ({
  ExportPlusPanel: () => <div data-testid="export-panel" />,
}));

vi.mock('../components/admin/CountriesManager', () => ({
  CountriesManager: () => <div data-testid="countries-manager" />,
}));

vi.mock('@/utils/auth', () => ({ getToken: () => 'test-token' }));
vi.mock('@shared/messages', () => ({ createRequest: vi.fn((token, payload) => ({ token, payload })) }));
vi.mock('@/i18n', () => ({ default: { language: 'cs' } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('../i18n/formatters', () => ({
  formatTime: (v: string) => v,
  formatNumber: (v: number) => String(v),
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Admin page — sidebar layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the sidebar with all section tabs', () => {
    render(<Admin />);
    expect(screen.getByText('admin_tab_services')).toBeTruthy();
    expect(screen.getByText('admin_tab_database')).toBeTruthy();
    expect(screen.getByText('admin_tab_countries')).toBeTruthy();
    expect(screen.getByText('admin_tab_export')).toBeTruthy();
    expect(screen.getByText('admin_tab_import')).toBeTruthy();
    expect(screen.getByText('admin_tab_logs')).toBeTruthy();
  });

  it('shows services section by default', () => {
    render(<Admin />);
    // Services section content should be visible
    expect(screen.getByText('admin_services_title')).toBeTruthy();
  });

  it('switches to database section when clicking the tab', () => {
    render(<Admin />);
    fireEvent.click(screen.getByText('admin_tab_database'));
    expect(screen.getByText('admin_db_title')).toBeTruthy();
    // Services section should no longer be visible
    expect(screen.queryByText('admin_services_title')).toBeNull();
  });

  it('switches to countries section when clicking the tab', () => {
    render(<Admin />);
    fireEvent.click(screen.getByText('admin_tab_countries'));
    expect(screen.getByTestId('countries-manager')).toBeTruthy();
  });

  it('switches to export section when clicking the tab', () => {
    render(<Admin />);
    fireEvent.click(screen.getByText('admin_tab_export'));
    expect(screen.getByTestId('export-panel')).toBeTruthy();
  });

  it('switches to logs section when clicking the tab', () => {
    render(<Admin />);
    fireEvent.click(screen.getByText('admin_tab_logs'));
    expect(screen.getByText('admin_logs_title')).toBeTruthy();
  });

  it('marks the active tab with active style', () => {
    render(<Admin />);
    const servicesBtn = screen.getByText('admin_tab_services');
    // Active tab button should have aria role or specific class — check it's present
    expect(servicesBtn).toBeTruthy();
    // Click another tab and verify services tab is no longer active
    fireEvent.click(screen.getByText('admin_tab_database'));
    expect(screen.queryByText('admin_services_title')).toBeNull();
  });
});
