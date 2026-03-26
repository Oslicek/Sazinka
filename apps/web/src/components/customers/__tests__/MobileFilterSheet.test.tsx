/**
 * Phase 5A (RED → GREEN) — MobileFilterSheet component tests.
 *
 * Tests trigger visibility by viewport, sheet content, filter interactions,
 * sort controls, and sheet open/close behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type { SortEntry } from '@/lib/customerColumns';
import {
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  ALL_COLUMNS,
} from '@/lib/customerColumns';
import { MobileFilterSheet } from '../MobileFilterSheet';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SheetProps {
  isMobile?: boolean;
  search?: string;
  onSearchChange?: (v: string) => void;
  revisionFilter?: '' | 'overdue' | 'week' | 'month';
  onRevisionFilterChange?: (v: '' | 'overdue' | 'week' | 'month') => void;
  sortModel?: SortEntry[];
  onSortModelChange?: (m: SortEntry[]) => void;
  visibleColumns?: string[];
  columnOrder?: string[];
  onVisibleColumnsChange?: (cols: string[]) => void;
  onColumnOrderChange?: (order: string[]) => void;
  onResetColumns?: () => void;
}

function renderSheet(overrides: SheetProps = {}) {
  const props: Required<SheetProps> = {
    isMobile: true,
    search: '',
    onSearchChange: vi.fn(),
    revisionFilter: '',
    onRevisionFilterChange: vi.fn(),
    sortModel: DEFAULT_SORT_MODEL,
    onSortModelChange: vi.fn(),
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    columnOrder: DEFAULT_COLUMN_ORDER,
    onVisibleColumnsChange: vi.fn(),
    onColumnOrderChange: vi.fn(),
    onResetColumns: vi.fn(),
    ...overrides,
  };
  return { ...render(<MobileFilterSheet {...props} />), props };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MobileFilterSheet', () => {

  // ── 1. Rendering ────────────────────────────────────────────────────────────

  it('1. isMobile=true → sheet trigger button visible', () => {
    renderSheet({ isMobile: true });
    expect(screen.getByTestId('mobile-filter-trigger')).toBeInTheDocument();
  });

  it('2. isMobile=false → sheet trigger button hidden', () => {
    renderSheet({ isMobile: false });
    expect(screen.queryByTestId('mobile-filter-trigger')).toBeNull();
  });

  it('3. click trigger → sheet opens', () => {
    renderSheet();
    expect(screen.queryByTestId('mobile-filter-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    expect(screen.getByTestId('mobile-filter-sheet')).toBeInTheDocument();
  });

  it('4. sheet has a drag handle', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    expect(screen.getByTestId('sheet-drag-handle')).toBeInTheDocument();
  });

  // ── 2. Sheet content ─────────────────────────────────────────────────────────

  it('5. sheet contains search input', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).getByRole('textbox')).toBeInTheDocument();
  });

  it('6. sheet contains due-bucket chips', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).getByRole('button', { name: 'filter_revision_all' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'filter_revision_overdue' })).toBeInTheDocument();
  });

  it('7. geocode filter NOT in sheet (removed Phase 6B)', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).queryByTestId('sheet-geocode-filter')).toBeNull();
  });

  it('8. type filter NOT in sheet (removed Phase 6B)', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).queryByTestId('sheet-type-filter')).toBeNull();
  });

  it('9. sheet contains primary sort picker with direction', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).getByTestId('sheet-sort-primary')).toBeInTheDocument();
    expect(within(sheet).getByTestId('sheet-sort-primary-dir')).toBeInTheDocument();
  });

  it('10. sheet contains secondary sort picker', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).getByTestId('sheet-sort-secondary')).toBeInTheDocument();
  });

  it('11. sheet contains column picker trigger', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    expect(within(sheet).getByTestId('sheet-column-picker-trigger')).toBeInTheDocument();
  });

  // ── 3. Interaction ────────────────────────────────────────────────────────────

  it('12. changing filter in sheet calls parent callback', () => {
    const onRevisionFilterChange = vi.fn();
    renderSheet({ onRevisionFilterChange });
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'filter_revision_overdue' }));
    expect(onRevisionFilterChange).toHaveBeenCalledWith('overdue');
  });

  it('13. changing sort in sheet calls onSortModelChange', () => {
    const onSortModelChange = vi.fn();
    renderSheet({ onSortModelChange, sortModel: [{ column: 'name', direction: 'asc' }] });
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    const dirSelect = within(sheet).getByTestId('sheet-sort-primary-dir');
    fireEvent.change(dirSelect, { target: { value: 'desc' } });
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'name', direction: 'desc' }]);
  });

  it('14. tap outside sheet → sheet closes', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    expect(screen.getByTestId('mobile-filter-sheet')).toBeInTheDocument();
    // Click the backdrop
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('mobile-filter-sheet')).toBeNull();
  });

  it('15. Apply button closes sheet', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    expect(screen.getByTestId('mobile-filter-sheet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sheet-apply-btn'));
    expect(screen.queryByTestId('mobile-filter-sheet')).toBeNull();
  });

  it('16. filter changes immediately reflected (no buffering)', () => {
    const onRevisionFilterChange = vi.fn();
    renderSheet({ revisionFilter: '', onRevisionFilterChange });
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    // Click overdue chip — callback fires immediately
    fireEvent.click(within(sheet).getByRole('button', { name: 'filter_revision_overdue' }));
    expect(onRevisionFilterChange).toHaveBeenCalledWith('overdue');
    expect(onRevisionFilterChange).toHaveBeenCalledTimes(1);
  });

  // ── 4. Sort in sheet ──────────────────────────────────────────────────────────

  it('17. sort picker shows sortable column options with translated labels', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    const sortPicker = within(sheet).getByTestId('sheet-sort-primary');
    const sortableColumns = ALL_COLUMNS.filter((c) => c.sortable);
    // Each sortable column should appear as an option
    sortableColumns.forEach((col) => {
      expect(within(sortPicker).getByText(col.labelKey)).toBeInTheDocument();
    });
  });

  it('18. selecting column + direction → onSortModelChange with single entry', () => {
    const onSortModelChange = vi.fn();
    renderSheet({ onSortModelChange, sortModel: [{ column: 'name', direction: 'asc' }] });
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    // Change primary sort to city
    fireEvent.change(within(sheet).getByTestId('sheet-sort-primary'), { target: { value: 'city' } });
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'city', direction: 'asc' }]);
  });

  it('19. adding secondary sort → onSortModelChange with 2 entries', () => {
    const onSortModelChange = vi.fn();
    renderSheet({ onSortModelChange, sortModel: [{ column: 'name', direction: 'asc' }] });
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    // Add secondary sort
    fireEvent.change(within(sheet).getByTestId('sheet-sort-secondary'), { target: { value: 'city' } });
    expect(onSortModelChange).toHaveBeenCalledWith([
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'asc' },
    ]);
  });

  it('20. "Clear sort" resets to default sort', () => {
    const onSortModelChange = vi.fn();
    renderSheet({
      onSortModelChange,
      sortModel: [{ column: 'city', direction: 'desc' }],
    });
    fireEvent.click(screen.getByTestId('mobile-filter-trigger'));
    const sheet = screen.getByTestId('mobile-filter-sheet');
    fireEvent.click(within(sheet).getByTestId('sheet-clear-sort-btn'));
    expect(onSortModelChange).toHaveBeenCalledWith(DEFAULT_SORT_MODEL);
  });
});
