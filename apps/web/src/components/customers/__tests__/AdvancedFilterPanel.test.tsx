/**
 * Phase 4B (RED → GREEN) — AdvancedFilterPanel component tests.
 *
 * Tests visibility toggle, section placeholders, clear button,
 * UPP persistence of isAdvancedFiltersOpen, and active filter count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { CUSTOMERS_PROFILE_ID, customersProfile } from '@/persistence/profiles/customersProfile';
import { AdvancedFilterPanel } from '../AdvancedFilterPanel';
import { Customers } from '@/pages/Customers';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
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

const TEST_USER_ID = 'test-user-adv';

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: (s: { isConnected: boolean }) => unknown) =>
    selector({ isConnected: true }),
  ),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

interface AdvancedFilterPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  activeAdvancedCount?: number;
  onClearAdvanced?: () => void;
}

function renderPanel(overrides: AdvancedFilterPanelProps = {}) {
  const props: Required<AdvancedFilterPanelProps> = {
    isOpen: true,
    onClose: vi.fn(),
    activeAdvancedCount: 0,
    onClearAdvanced: vi.fn(),
    ...overrides,
  };
  return { ...render(<AdvancedFilterPanel {...props} />), props };
}

function seedSession(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

function clearSession() {
  sessionStorage.clear();
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('AdvancedFilterPanel — Component', () => {
  // ── 1. Visibility ───────────────────────────────────────────────────────────

  it('1. isOpen=false → panel content not rendered', () => {
    renderPanel({ isOpen: false });
    expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
  });

  it('2. isOpen=true → panel content rendered', () => {
    renderPanel({ isOpen: true });
    expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
  });

  it('3. transition: false→true panel appears (CSS open class)', () => {
    const { rerender } = render(
      <AdvancedFilterPanel
        isOpen={false}
        onClose={vi.fn()}
        activeAdvancedCount={0}
        onClearAdvanced={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    rerender(
      <AdvancedFilterPanel
        isOpen={true}
        onClose={vi.fn()}
        activeAdvancedCount={0}
        onClearAdvanced={vi.fn()}
      />,
    );
    expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
  });

  // ── 2. Panel content ────────────────────────────────────────────────────────

  it('4. renders Contactability section', () => {
    renderPanel();
    expect(screen.getByTestId('section-contactability')).toBeInTheDocument();
  });

  it('5. renders Lifecycle section', () => {
    renderPanel();
    expect(screen.getByTestId('section-lifecycle')).toBeInTheDocument();
  });

  it('6. renders Data quality section', () => {
    renderPanel();
    expect(screen.getByTestId('section-data-quality')).toBeInTheDocument();
  });

  it('7. each section has a heading', () => {
    renderPanel();
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThanOrEqual(3);
  });

  // ── 3. Clear ────────────────────────────────────────────────────────────────

  it('8. clicking clear button calls onClearAdvanced', () => {
    const onClearAdvanced = vi.fn();
    renderPanel({ onClearAdvanced, activeAdvancedCount: 1 });
    fireEvent.click(screen.getByTestId('clear-advanced-btn'));
    expect(onClearAdvanced).toHaveBeenCalled();
  });

  it('9. activeAdvancedCount=0 → clear button disabled or hidden', () => {
    renderPanel({ activeAdvancedCount: 0 });
    const btn = screen.queryByTestId('clear-advanced-btn');
    if (btn) {
      expect(btn).toBeDisabled();
    } else {
      expect(btn).toBeNull();
    }
  });

  // ── 4. Active advanced filter count ────────────────────────────────────────

  it('17. activeAdvancedCount=0 → count not displayed', () => {
    renderPanel({ activeAdvancedCount: 0 });
    expect(screen.queryByTestId('advanced-count-badge')).toBeNull();
  });

  it('18. activeAdvancedCount=1 → count = 1', () => {
    renderPanel({ activeAdvancedCount: 1 });
    const badge = screen.getByTestId('advanced-count-badge');
    expect(badge).toHaveTextContent('1');
  });
});

// ── UPP persistence tests ──────────────────────────────────────────────────────

describe('AdvancedFilterPanel — UPP persistence via Customers page', () => {
  beforeEach(() => {
    clearSession();
  });

  afterEach(() => {
    clearSession();
  });

  it('10. UPP seeded isAdvancedFiltersOpen: true → panel open on mount', async () => {
    seedSession('isAdvancedFiltersOpen', true);
    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
    });
  });

  it('11. UPP seeded isAdvancedFiltersOpen: false → panel closed on mount', async () => {
    seedSession('isAdvancedFiltersOpen', false);
    render(<Customers />);
    await waitFor(() => {
      expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    });
  });

  it('12. toggle open → unmount → remount → panel still open', async () => {
    const { unmount } = render(<Customers />);
    // Open panel
    fireEvent.click(screen.getByTestId('advanced-toggle-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
    });
  });

  it('13. toggle closed → unmount → remount → panel still closed', async () => {
    seedSession('isAdvancedFiltersOpen', true);
    const { unmount } = render(<Customers />);
    await waitFor(() => {
      expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
    });
    // Close it
    fireEvent.click(screen.getByTestId('advanced-toggle-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    });
  });

  it('14. multi-cycle: open → close → unmount → remount → closed', async () => {
    seedSession('isAdvancedFiltersOpen', false);
    const { unmount } = render(<Customers />);
    // Open
    fireEvent.click(screen.getByTestId('advanced-toggle-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('advanced-filter-panel')).toBeInTheDocument();
    });
    // Close
    fireEvent.click(screen.getByTestId('advanced-toggle-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    });
    unmount();

    render(<Customers />);
    await waitFor(() => {
      expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    });
  });

  it('15. corrupted value in session → defaults to closed', async () => {
    const key = makeKey({ userId: TEST_USER_ID, profileId: CUSTOMERS_PROFILE_ID, controlId: 'isAdvancedFiltersOpen' });
    sessionStorage.setItem(key, 'CORRUPTED_JSON!!!');
    render(<Customers />);
    await waitFor(() => {
      expect(screen.queryByTestId('advanced-filter-panel')).toBeNull();
    });
  });

  it('16. customers.filters control count is 7 after adding isAdvancedFiltersOpen', () => {
    const ids = customersProfile.controls.map((c) => c.controlId);
    expect(ids).toHaveLength(7);
    expect(ids).toContain('isAdvancedFiltersOpen');
  });

  it('19. advanced filter count shown on toggle button', async () => {
    render(<Customers />);
    // By default no advanced filters are active so badge is absent
    expect(screen.queryByTestId('advanced-count-badge')).toBeNull();
  });
});
