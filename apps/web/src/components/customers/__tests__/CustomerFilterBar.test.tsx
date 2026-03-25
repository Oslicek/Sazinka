/**
 * Phase 4A (RED → GREEN) — CustomerFilterBar component tests.
 *
 * Tests search input, due-bucket chips, geocode filter,
 * type filter, active filter count badge, clear-all,
 * advanced toggle, column picker integration, and view mode toggle.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type { SortEntry } from '@/lib/customerColumns';
import {
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
} from '@/lib/customerColumns';
import { CustomerFilterBar } from '../CustomerFilterBar';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})`;
      }
      return key;
    },
  }),
}));

// Stub ColumnPicker — tested separately
vi.mock('../ColumnPicker', () => ({
  ColumnPicker: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="column-picker-stub" onClick={onClose}>ColumnPicker</div>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type GeocodeStatus = 'success' | 'failed' | 'pending';

interface FilterBarProps {
  search?: string;
  onSearchChange?: (v: string) => void;
  geocodeFilter?: GeocodeStatus | '';
  onGeocodeFilterChange?: (v: GeocodeStatus | '') => void;
  revisionFilter?: '' | 'overdue' | 'week' | 'month';
  onRevisionFilterChange?: (v: '' | 'overdue' | 'week' | 'month') => void;
  typeFilter?: 'company' | 'person' | '';
  onTypeFilterChange?: (v: 'company' | 'person' | '') => void;
  activeFilterCount?: number;
  onClearAllFilters?: () => void;
  isAdvancedOpen?: boolean;
  onToggleAdvanced?: () => void;
  sortModel?: SortEntry[];
  onSortModelChange?: (m: SortEntry[]) => void;
  visibleColumns?: string[];
  columnOrder?: string[];
  onVisibleColumnsChange?: (cols: string[]) => void;
  onColumnOrderChange?: (order: string[]) => void;
  onResetColumns?: () => void;
  viewMode?: 'table' | 'cards';
  onViewModeChange?: (mode: 'table' | 'cards') => void;
}

function renderBar(overrides: FilterBarProps = {}) {
  const props: Required<FilterBarProps> = {
    search: '',
    onSearchChange: vi.fn(),
    geocodeFilter: '',
    onGeocodeFilterChange: vi.fn(),
    revisionFilter: '',
    onRevisionFilterChange: vi.fn(),
    typeFilter: '',
    onTypeFilterChange: vi.fn(),
    activeFilterCount: 0,
    onClearAllFilters: vi.fn(),
    isAdvancedOpen: false,
    onToggleAdvanced: vi.fn(),
    sortModel: DEFAULT_SORT_MODEL,
    onSortModelChange: vi.fn(),
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    columnOrder: DEFAULT_COLUMN_ORDER,
    onVisibleColumnsChange: vi.fn(),
    onColumnOrderChange: vi.fn(),
    onResetColumns: vi.fn(),
    viewMode: 'table',
    onViewModeChange: vi.fn(),
    ...overrides,
  };

  const { container } = render(<CustomerFilterBar {...props} />);
  return { props, container };
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('CustomerFilterBar', () => {
  // ── 1. Search input ─────────────────────────────────────────────────────────

  it('1. renders search input with current search value', () => {
    renderBar({ search: 'acme' });
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('acme');
  });

  it('2. typing calls onSearchChange', () => {
    const onSearchChange = vi.fn();
    renderBar({ onSearchChange });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new' } });
    expect(onSearchChange).toHaveBeenCalledWith('new');
  });

  it('3. empty search → no clear button', () => {
    renderBar({ search: '' });
    expect(screen.queryByRole('button', { name: /clear.search|×|✕/i })).toBeNull();
  });

  it('4. non-empty search → clear button visible; click calls onSearchChange(\'\')', () => {
    const onSearchChange = vi.fn();
    renderBar({ search: 'test', onSearchChange });
    const clearBtn = screen.getByTestId('search-clear-btn');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  // ── 2. Due-bucket chips ─────────────────────────────────────────────────────

  it('5. renders chips: All, Overdue, Within 7 days, Within 30 days', () => {
    renderBar();
    // translation keys returned as-is by the mock
    expect(screen.getByRole('button', { name: 'filter_revision_all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'filter_revision_overdue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'filter_revision_week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'filter_revision_month' })).toBeInTheDocument();
  });

  it('6. revisionFilter=\'\' → "All" chip active', () => {
    renderBar({ revisionFilter: '' });
    const allChip = screen.getByRole('button', { name: 'filter_revision_all' });
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
  });

  it('7. revisionFilter=\'overdue\' → Overdue chip active', () => {
    renderBar({ revisionFilter: 'overdue' });
    const chip = screen.getByRole('button', { name: 'filter_revision_overdue' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const allChip = screen.getByRole('button', { name: 'filter_revision_all' });
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('8. clicking "Overdue" chip calls onRevisionFilterChange(\'overdue\')', () => {
    const onRevisionFilterChange = vi.fn();
    renderBar({ revisionFilter: '', onRevisionFilterChange });
    fireEvent.click(screen.getByRole('button', { name: 'filter_revision_overdue' }));
    expect(onRevisionFilterChange).toHaveBeenCalledWith('overdue');
  });

  it('9. clicking active chip calls onRevisionFilterChange(\'\') (toggle off)', () => {
    const onRevisionFilterChange = vi.fn();
    renderBar({ revisionFilter: 'overdue', onRevisionFilterChange });
    fireEvent.click(screen.getByRole('button', { name: 'filter_revision_overdue' }));
    expect(onRevisionFilterChange).toHaveBeenCalledWith('');
  });

  // ── 3. Geocode quick filter ─────────────────────────────────────────────────

  it('10. renders geocode filter chips/dropdown', () => {
    renderBar();
    // At minimum the "all geocode" option exists
    expect(screen.getByTestId('geocode-filter')).toBeInTheDocument();
  });

  it('11. selecting failed calls onGeocodeFilterChange(\'failed\')', () => {
    const onGeocodeFilterChange = vi.fn();
    renderBar({ onGeocodeFilterChange });
    const el = screen.getByTestId('geocode-filter');
    fireEvent.change(el, { target: { value: 'failed' } });
    expect(onGeocodeFilterChange).toHaveBeenCalledWith('failed');
  });

  it('12. active geocode filter is visually indicated', () => {
    renderBar({ geocodeFilter: 'failed' });
    const el = screen.getByTestId('geocode-filter');
    expect(el).toHaveAttribute('data-active', 'true');
  });

  // ── 4. Type filter ──────────────────────────────────────────────────────────

  it('13. renders type filter with translated labels', () => {
    renderBar();
    const el = screen.getByTestId('type-filter');
    // translated option text (mock returns key)
    expect(within(el).getByText('filter_type_all')).toBeInTheDocument();
    expect(within(el).getByText('filter_type_company')).toBeInTheDocument();
    expect(within(el).getByText('filter_type_person')).toBeInTheDocument();
  });

  it('14. selecting company calls onTypeFilterChange(\'company\')', () => {
    const onTypeFilterChange = vi.fn();
    renderBar({ onTypeFilterChange });
    const el = screen.getByTestId('type-filter');
    fireEvent.change(el, { target: { value: 'company' } });
    expect(onTypeFilterChange).toHaveBeenCalledWith('company');
  });

  // ── 5. Active filter count badge ────────────────────────────────────────────

  it('15. activeFilterCount=0 → no badge', () => {
    renderBar({ activeFilterCount: 0 });
    expect(screen.queryByTestId('active-filter-badge')).toBeNull();
  });

  it('16. activeFilterCount=3 → badge shows "3"', () => {
    renderBar({ activeFilterCount: 3 });
    const badge = screen.getByTestId('active-filter-badge');
    expect(badge).toHaveTextContent('3');
  });

  // ── 6. Clear all ────────────────────────────────────────────────────────────

  it('17. clear-all button calls onClearAllFilters', () => {
    const onClearAllFilters = vi.fn();
    renderBar({ activeFilterCount: 2, onClearAllFilters });
    const btn = screen.getByTestId('clear-all-btn');
    fireEvent.click(btn);
    expect(onClearAllFilters).toHaveBeenCalled();
  });

  it('18. clear-all button hidden when activeFilterCount === 0', () => {
    renderBar({ activeFilterCount: 0 });
    expect(screen.queryByTestId('clear-all-btn')).toBeNull();
  });

  // ── 7. Advanced filters toggle ──────────────────────────────────────────────

  it('19. advanced toggle button present with accessible label', () => {
    renderBar();
    expect(screen.getByTestId('advanced-toggle-btn')).toBeInTheDocument();
  });

  it('20. clicking toggle calls onToggleAdvanced', () => {
    const onToggleAdvanced = vi.fn();
    renderBar({ onToggleAdvanced });
    fireEvent.click(screen.getByTestId('advanced-toggle-btn'));
    expect(onToggleAdvanced).toHaveBeenCalled();
  });

  it('21. isAdvancedOpen=true → toggle has aria-expanded="true"', () => {
    renderBar({ isAdvancedOpen: true });
    expect(screen.getByTestId('advanced-toggle-btn')).toHaveAttribute('aria-expanded', 'true');
  });

  // ── 8. Column picker integration ────────────────────────────────────────────

  it('22. column picker trigger button rendered in table mode', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.getByTestId('column-picker-trigger')).toBeInTheDocument();
  });

  it('23. clicking column picker trigger opens ColumnPicker', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.queryByTestId('column-picker-stub')).toBeNull();
    fireEvent.click(screen.getByTestId('column-picker-trigger'));
    expect(screen.getByTestId('column-picker-stub')).toBeInTheDocument();
  });

  // ── 9. View mode toggle ─────────────────────────────────────────────────────

  it('24. table and cards toggle buttons rendered', () => {
    renderBar();
    expect(screen.getByTestId('view-table-btn')).toBeInTheDocument();
    expect(screen.getByTestId('view-cards-btn')).toBeInTheDocument();
  });

  it('25. clicking table icon calls onViewModeChange(\'table\')', () => {
    const onViewModeChange = vi.fn();
    renderBar({ viewMode: 'cards', onViewModeChange });
    fireEvent.click(screen.getByTestId('view-table-btn'));
    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('26. clicking cards icon calls onViewModeChange(\'cards\')', () => {
    const onViewModeChange = vi.fn();
    renderBar({ viewMode: 'table', onViewModeChange });
    fireEvent.click(screen.getByTestId('view-cards-btn'));
    expect(onViewModeChange).toHaveBeenCalledWith('cards');
  });

  it('27. active view mode button has aria-pressed="true"', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.getByTestId('view-table-btn')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-cards-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  it('28. in cards mode, column picker trigger is not rendered', () => {
    renderBar({ viewMode: 'cards' });
    expect(screen.queryByTestId('column-picker-trigger')).toBeNull();
  });
});
