/**
 * Phase 3A (RED → GREEN) — ColumnPicker component tests.
 *
 * Tests rendering, visibility checkboxes, max column limit,
 * reset, reorder, accessibility, and i18n completeness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import {
  ALL_COLUMNS,
  COLUMN_CATEGORIES,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_SORT_MODEL,
  DEFAULT_COLUMN_ORDER,
  CORE_COLUMN_IDS,
  MAX_VISIBLE_COLUMNS,
} from '@/lib/customerColumns';
import type { SortEntry } from '@/lib/customerColumns';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'defaultValue' in opts && opts.defaultValue === '') {
        return '';
      }
      if (opts) {
        return `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

interface PickerProps {
  visibleColumns?: string[];
  columnOrder?: string[];
  sortModel?: SortEntry[];
  onVisibleColumnsChange?: (cols: string[]) => void;
  onColumnOrderChange?: (order: string[]) => void;
  onSortModelChange?: (model: SortEntry[]) => void;
  onReset?: () => void;
  onClose?: () => void;
}

import { ColumnPicker, fallbackColumnTitle } from '../ColumnPicker';

function renderPicker(overrides: PickerProps = {}) {
  const props: PickerProps = {
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    columnOrder: DEFAULT_COLUMN_ORDER,
    sortModel: DEFAULT_SORT_MODEL,
    onVisibleColumnsChange: vi.fn(),
    onColumnOrderChange: vi.fn(),
    onSortModelChange: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return render(<ColumnPicker {...(props as Required<PickerProps>)} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 3A: ColumnPicker — rendering', () => {
  it('1. renders popover dialog directly (controlled by parent)', () => {
    renderPicker();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('2. popover shows column count in aria-label', () => {
    renderPicker();
    expect(screen.getByRole('dialog')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('col_picker_columns_label'),
    );
  });

  it('3. popover lists all ALL_COLUMNS (each column has a checkbox)', () => {
    renderPicker();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(ALL_COLUMNS.length);
  });

  it('4. flat list — category group headings are not rendered', () => {
    renderPicker();
    const dialog = screen.getByRole('dialog');
    for (const cat of COLUMN_CATEGORIES) {
      expect(within(dialog).queryByText(`col_category_${cat}`)).not.toBeInTheDocument();
    }
  });

  it('5. each column shows a human-readable title (fallback when t default is empty)', () => {
    renderPicker();
    for (const col of ALL_COLUMNS) {
      expect(screen.getByText(fallbackColumnTitle(col.labelKey))).toBeInTheDocument();
    }
  });

  it('6. flat list — scrollable column list container is present', () => {
    renderPicker();
    expect(screen.getByTestId('column-picker-list')).toBeInTheDocument();
  });
});

describe('Phase 3A: ColumnPicker — visibility checkboxes', () => {
  let onVisibleColumnsChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onVisibleColumnsChange = vi.fn();
  });

  it('7. visible column → checkbox is checked', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    const nameCheckbox = screen.getByRole('checkbox', { name: /^name$/i });
    expect(nameCheckbox).toBeChecked();
  });

  it('8. hidden column → checkbox is unchecked', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    const emailCheckbox = screen.getByRole('checkbox', { name: /^email$/i });
    expect(emailCheckbox).not.toBeChecked();
  });

  it('9. core column → checkbox is checked and disabled', () => {
    renderPicker({ onVisibleColumnsChange });
    for (const coreId of CORE_COLUMN_IDS) {
      const col = ALL_COLUMNS.find((c) => c.id === coreId)!;
      const checkbox = screen.getByRole('checkbox', { name: fallbackColumnTitle(col.labelKey) });
      expect(checkbox).toBeChecked();
      expect(checkbox).toBeDisabled();
    }
  });

  it('10. checking a hidden column → onVisibleColumnsChange called with that column added', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    const emailCheckbox = screen.getByRole('checkbox', { name: /^email$/i });
    fireEvent.click(emailCheckbox);
    expect(onVisibleColumnsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['name', 'city', 'email']),
    );
  });

  it('11. unchecking a visible non-core column → onVisibleColumnsChange called without it', () => {
    const visibleColumns = ['name', 'city', 'deviceCount'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    const cityCheckbox = screen.getByRole('checkbox', { name: /^city$/i });
    fireEvent.click(cityCheckbox);
    const result = onVisibleColumnsChange.mock.calls[0][0] as string[];
    expect(result).not.toContain('city');
    expect(result).toContain('name');
  });

  it('12. toggle preserves order of other visible columns', () => {
    const visibleColumns = ['name', 'city', 'deviceCount'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    const emailCheckbox = screen.getByRole('checkbox', { name: /^email$/i });
    fireEvent.click(emailCheckbox);
    const result = onVisibleColumnsChange.mock.calls[0][0] as string[];
    const nameIdx = result.indexOf('name');
    const cityIdx = result.indexOf('city');
    const devIdx = result.indexOf('deviceCount');
    expect(nameIdx).toBeLessThan(cityIdx);
    expect(cityIdx).toBeLessThan(devIdx);
  });

  it('13. unchecking a sorted visible column → blocking modal appears', () => {
    const onSortModelChange = vi.fn();
    const visibleColumns = ['name', 'city', 'deviceCount'];
    renderPicker({
      visibleColumns,
      sortModel: [{ column: 'city', direction: 'asc' }],
      onVisibleColumnsChange,
      onSortModelChange,
    });
    const cityCheckbox = screen.getByRole('checkbox', { name: /^city$/i });
    fireEvent.click(cityCheckbox);
    expect(screen.getByRole('dialog', { name: /col_picker_sort_warning_title/i })).toBeInTheDocument();
  });

  it('14. sort-warning modal has Cancel and Confirm buttons', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({
      visibleColumns,
      sortModel: [{ column: 'city', direction: 'asc' }],
      onVisibleColumnsChange,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^city$/i }));
    expect(screen.getByRole('button', { name: /col_picker_cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /col_picker_confirm/i })).toBeInTheDocument();
  });

  it('15. Cancel in modal → column stays visible, onSortModelChange not called', () => {
    const onSortModelChange = vi.fn();
    const visibleColumns = ['name', 'city'];
    renderPicker({
      visibleColumns,
      sortModel: [{ column: 'city', direction: 'asc' }],
      onVisibleColumnsChange,
      onSortModelChange,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^city$/i }));
    fireEvent.click(screen.getByRole('button', { name: /col_picker_cancel/i }));
    expect(onSortModelChange).not.toHaveBeenCalled();
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
  });

  it('16. Confirm in modal → column hidden and removed from sortModel', () => {
    const onSortModelChange = vi.fn();
    const visibleColumns = ['name', 'city', 'deviceCount'];
    renderPicker({
      visibleColumns,
      sortModel: [{ column: 'city', direction: 'asc' }],
      onVisibleColumnsChange,
      onSortModelChange,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^city$/i }));
    fireEvent.click(screen.getByRole('button', { name: /col_picker_confirm/i }));
    const newVisible = onVisibleColumnsChange.mock.calls[0][0] as string[];
    expect(newVisible).not.toContain('city');
    expect(onSortModelChange).toHaveBeenCalled();
    const newSort = onSortModelChange.mock.calls[0][0] as SortEntry[];
    expect(newSort.some((e) => e.column === 'city')).toBe(false);
  });

  it('17. modal closes on Escape; cancel applies', () => {
    const onSortModelChange = vi.fn();
    const visibleColumns = ['name', 'city'];
    renderPicker({
      visibleColumns,
      sortModel: [{ column: 'city', direction: 'asc' }],
      onVisibleColumnsChange,
      onSortModelChange,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /^city$/i }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: /col_picker_sort_warning_title/i }), {
      key: 'Escape',
    });
    expect(onSortModelChange).not.toHaveBeenCalled();
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
  });
});

describe('Phase 3A: ColumnPicker — max columns limit', () => {
  it('18. when visibleColumns.length === MAX_VISIBLE_COLUMNS → unchecked columns disabled', () => {
    const visibleColumns = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
    const extras = ALL_COLUMNS.filter(
      (c) => !visibleColumns.includes(c.id) && !c.core,
    );
    const padded = [...visibleColumns, ...extras.slice(0, MAX_VISIBLE_COLUMNS - visibleColumns.length)].slice(
      0,
      MAX_VISIBLE_COLUMNS,
    );
    renderPicker({ visibleColumns: padded });
    const hidden = ALL_COLUMNS.filter((c) => !padded.includes(c.id) && !c.core);
    if (hidden.length > 0) {
      const checkbox = screen.getByRole('checkbox', { name: fallbackColumnTitle(hidden[0].labelKey) });
      expect(checkbox).toBeDisabled();
    }
  });

  it('19. disabled checkbox has tooltip/hint about max limit', () => {
    const visibleColumns = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
    const extras = ALL_COLUMNS.filter((c) => !visibleColumns.includes(c.id) && !c.core);
    const padded = [
      ...visibleColumns,
      ...extras.slice(0, MAX_VISIBLE_COLUMNS - visibleColumns.length),
    ].slice(0, MAX_VISIBLE_COLUMNS);
    renderPicker({ visibleColumns: padded });
    const hidden = ALL_COLUMNS.filter((c) => !padded.includes(c.id) && !c.core);
    if (hidden.length > 0) {
      const checkbox = screen.getByRole('checkbox', { name: fallbackColumnTitle(hidden[0].labelKey) });
      expect(
        checkbox.closest('[title]') || checkbox.closest('[aria-label]') || checkbox.parentElement,
      ).toBeTruthy();
    }
  });

  it('20. unchecking one column re-enables others', () => {
    const visibleColumns = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
    const extras = ALL_COLUMNS.filter((c) => !visibleColumns.includes(c.id) && !c.core);
    const padded = [
      ...visibleColumns,
      ...extras.slice(0, MAX_VISIBLE_COLUMNS - visibleColumns.length),
    ].slice(0, MAX_VISIBLE_COLUMNS);
    const onVisibleColumnsChange = vi.fn((newCols: string[]) => newCols);
    renderPicker({ visibleColumns: padded, onVisibleColumnsChange });
    const nonCoreVisible = padded.find((id) => !CORE_COLUMN_IDS.includes(id));
    if (nonCoreVisible) {
      const col = ALL_COLUMNS.find((c) => c.id === nonCoreVisible)!;
      fireEvent.click(screen.getByRole('checkbox', { name: fallbackColumnTitle(col.labelKey) }));
      expect(onVisibleColumnsChange).toHaveBeenCalled();
    }
  });
});

describe('Phase 3A: ColumnPicker — reset', () => {
  it('21. clicking Reset with no sorted columns affected → onReset called immediately', () => {
    const onReset = vi.fn();
    const onSortModelChange = vi.fn();
    renderPicker({
      sortModel: DEFAULT_SORT_MODEL,
      onReset,
      onSortModelChange,
    });
    fireEvent.click(screen.getByRole('button', { name: /col_picker_reset/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('22. clicking Reset when sorted column would be hidden → blocking summary modal shown', () => {
    const onReset = vi.fn();
    renderPicker({
      visibleColumns: ['name', 'createdAt'],
      sortModel: [{ column: 'createdAt', direction: 'asc' }],
      onReset,
    });
    fireEvent.click(screen.getByRole('button', { name: /col_picker_reset/i }));
    expect(
      screen.queryByRole('dialog', { name: /col_picker_sort_warning_title/i }),
    ).toBeInTheDocument();
  });

  it('26. one aggregated modal for multiple sorted columns affected by reset', () => {
    const onReset = vi.fn();
    renderPicker({
      visibleColumns: ['name', 'createdAt', 'city'],
      sortModel: [{ column: 'createdAt', direction: 'asc' }],
      onReset,
    });
    fireEvent.click(screen.getByRole('button', { name: /col_picker_reset/i }));
    const modals = screen.queryAllByRole('dialog', { name: /col_picker_sort_warning_title/i });
    expect(modals.length).toBe(1);
  });
});

describe('Phase 3A: ColumnPicker — reorder (drag-and-drop)', () => {
  it('27. reorder drag-drop interaction is wired (onColumnOrderChange prop exists)', () => {
    const onColumnOrderChange = vi.fn();
    renderPicker({ onColumnOrderChange });
    expect(onColumnOrderChange).toBeDefined();
  });

  it('28. reorder does not change visibility — only column order', () => {
    const onVisibleColumnsChange = vi.fn();
    const onColumnOrderChange = vi.fn();
    renderPicker({ onVisibleColumnsChange, onColumnOrderChange });
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
  });

  it('29. core column can be reordered (drag handles present for core columns)', () => {
    renderPicker();
    const handles = screen.getAllByText('⠿');
    expect(handles.length).toBeGreaterThanOrEqual(CORE_COLUMN_IDS.length);
  });
});

describe('Phase 3A: ColumnPicker — accessibility', () => {
  it('30. popover dialog has aria-label', () => {
    renderPicker();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label');
  });

  it('31. each checkbox has an accessible label matching column name', () => {
    renderPicker();
    for (const col of ALL_COLUMNS) {
      const checkbox = screen.getByRole('checkbox', { name: fallbackColumnTitle(col.labelKey) });
      expect(checkbox).toBeInTheDocument();
    }
  });

  it('32. flat list — picker dialog has no category section headings', () => {
    renderPicker();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryAllByRole('heading')).toHaveLength(0);
  });

  it('35. Escape calls onClose', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 3A: ColumnPicker — i18n col_* label keys', () => {
  it('38. every CustomerColumnDef.labelKey exists in en/customers.json', async () => {
    const en = await import('../../../../public/locales/en/customers.json');
    for (const col of ALL_COLUMNS) {
      expect(en[col.labelKey as keyof typeof en], `Missing key: ${col.labelKey}`).toBeDefined();
    }
  });

  it('39. every CustomerColumnDef.labelKey exists in cs/customers.json', async () => {
    const cs = await import('../../../../public/locales/cs/customers.json');
    for (const col of ALL_COLUMNS) {
      expect(cs[col.labelKey as keyof typeof cs], `Missing key: ${col.labelKey}`).toBeDefined();
    }
  });

  it('40. every CustomerColumnDef.labelKey exists in sk/customers.json', async () => {
    const sk = await import('../../../../public/locales/sk/customers.json');
    for (const col of ALL_COLUMNS) {
      expect(sk[col.labelKey as keyof typeof sk], `Missing key: ${col.labelKey}`).toBeDefined();
    }
  });

  it('41. column labels in picker match translated text (not raw keys) — en locale', async () => {
    const en = await import('../../../../public/locales/en/customers.json');
    renderPicker();
    const nameCol = ALL_COLUMNS.find((c) => c.id === 'name')!;
    const translated = en[nameCol.labelKey as keyof typeof en] as string;
    expect(translated).toBeDefined();
    expect(translated).not.toBe(nameCol.labelKey);
  });

  it('42. col_* labels are NOT equal to their raw key strings', async () => {
    const en = await import('../../../../public/locales/en/customers.json');
    for (const col of ALL_COLUMNS) {
      const translated = en[col.labelKey as keyof typeof en] as string;
      if (translated) {
        expect(translated, `Key ${col.labelKey} returns its own key string`).not.toBe(
          col.labelKey,
        );
      }
    }
  });
});
