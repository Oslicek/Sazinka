/**
 * Phase 4A (RED → GREEN) — CustomerFilterBar component tests.
 *
 * Tests search input, due-bucket chips, active filter count badge, clear-all,
 * advanced toggle, column picker integration, and view mode toggle.
 *
 * Note: geocodeFilter and typeFilter dropdowns were removed in Phase 6B.
 * Column-based filtering is now handled by per-column header icons.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

interface FilterBarProps {
  search?: string;
  onSearchChange?: (v: string) => void;
  revisionFilter?: '' | 'overdue' | 'week' | 'month';
  onRevisionFilterChange?: (v: '' | 'overdue' | 'week' | 'month') => void;
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
    revisionFilter: '',
    onRevisionFilterChange: vi.fn(),
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

  // ── 3. Legacy filters removed (Phase 6B) ────────────────────────────────────

  it('10. geocode filter dropdown is NOT rendered (removed in Phase 6B)', () => {
    renderBar();
    expect(screen.queryByTestId('geocode-filter')).toBeNull();
  });

  it('11. type filter dropdown is NOT rendered (removed in Phase 6B)', () => {
    renderBar();
    expect(screen.queryByTestId('type-filter')).toBeNull();
  });

  // ── 4. Active filter count badge ────────────────────────────────────────────

  it('12. activeFilterCount=0 → no badge', () => {
    renderBar({ activeFilterCount: 0 });
    expect(screen.queryByTestId('active-filter-badge')).toBeNull();
  });

  it('13. activeFilterCount=3 → badge shows "3"', () => {
    renderBar({ activeFilterCount: 3 });
    const badge = screen.getByTestId('active-filter-badge');
    expect(badge).toHaveTextContent('3');
  });

  // ── 6. Clear all ────────────────────────────────────────────────────────────

  it('14. clear-all button calls onClearAllFilters', () => {
    const onClearAllFilters = vi.fn();
    renderBar({ activeFilterCount: 2, onClearAllFilters });
    const btn = screen.getByTestId('clear-all-btn');
    fireEvent.click(btn);
    expect(onClearAllFilters).toHaveBeenCalled();
  });

  it('15. clear-all button hidden when activeFilterCount === 0', () => {
    renderBar({ activeFilterCount: 0 });
    expect(screen.queryByTestId('clear-all-btn')).toBeNull();
  });

  // ── 7. Advanced filters toggle ──────────────────────────────────────────────

  it('16. advanced toggle button present with accessible label', () => {
    renderBar();
    expect(screen.getByTestId('advanced-toggle-btn')).toBeInTheDocument();
  });

  it('17. clicking toggle calls onToggleAdvanced', () => {
    const onToggleAdvanced = vi.fn();
    renderBar({ onToggleAdvanced });
    fireEvent.click(screen.getByTestId('advanced-toggle-btn'));
    expect(onToggleAdvanced).toHaveBeenCalled();
  });

  it('18. isAdvancedOpen=true → toggle has aria-expanded="true"', () => {
    renderBar({ isAdvancedOpen: true });
    expect(screen.getByTestId('advanced-toggle-btn')).toHaveAttribute('aria-expanded', 'true');
  });

  // ── 8. Column picker integration ────────────────────────────────────────────

  it('19. column picker trigger button rendered in table mode', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.getByTestId('column-picker-trigger')).toBeInTheDocument();
  });

  it('20. clicking column picker trigger opens ColumnPicker', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.queryByTestId('column-picker-stub')).toBeNull();
    fireEvent.click(screen.getByTestId('column-picker-trigger'));
    expect(screen.getByTestId('column-picker-stub')).toBeInTheDocument();
  });

  // ── 9. View mode toggle ─────────────────────────────────────────────────────

  it('21. table and cards toggle buttons rendered', () => {
    renderBar();
    expect(screen.getByTestId('view-table-btn')).toBeInTheDocument();
    expect(screen.getByTestId('view-cards-btn')).toBeInTheDocument();
  });

  it('22. clicking table icon calls onViewModeChange(\'table\')', () => {
    const onViewModeChange = vi.fn();
    renderBar({ viewMode: 'cards', onViewModeChange });
    fireEvent.click(screen.getByTestId('view-table-btn'));
    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('23. clicking cards icon calls onViewModeChange(\'cards\')', () => {
    const onViewModeChange = vi.fn();
    renderBar({ viewMode: 'table', onViewModeChange });
    fireEvent.click(screen.getByTestId('view-cards-btn'));
    expect(onViewModeChange).toHaveBeenCalledWith('cards');
  });

  it('24. active view mode button has aria-pressed="true"', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.getByTestId('view-table-btn')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-cards-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  it('25. in cards mode, column picker trigger is not rendered', () => {
    renderBar({ viewMode: 'cards' });
    expect(screen.queryByTestId('column-picker-trigger')).toBeNull();
  });
});
