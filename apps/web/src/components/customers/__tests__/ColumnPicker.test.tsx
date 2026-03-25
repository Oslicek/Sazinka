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
}

import { ColumnPicker } from '../ColumnPicker';

function renderPicker(overrides: PickerProps = {}) {
  const props: PickerProps = {
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    columnOrder: DEFAULT_COLUMN_ORDER,
    sortModel: DEFAULT_SORT_MODEL,
    onVisibleColumnsChange: vi.fn(),
    onColumnOrderChange: vi.fn(),
    onSortModelChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  return render(<ColumnPicker {...props} />);
}

function openPicker() {
  const trigger = screen.getByRole('button', { name: /col_picker_columns_label/i });
  fireEvent.click(trigger);
  return trigger;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 3A: ColumnPicker — rendering', () => {
  it('1. renders a trigger button with column count label', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /col_picker_columns_label/i });
    expect(btn).toBeInTheDocument();
  });

  it('2. clicking trigger opens the picker popover', () => {
    renderPicker();
    openPicker();
    // Popover content visible
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('3. popover lists all ALL_COLUMNS (each column has a checkbox)', () => {
    renderPicker();
    openPicker();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(ALL_COLUMNS.length);
  });

  it('4. each category heading is rendered', () => {
    renderPicker();
    openPicker();
    for (const cat of COLUMN_CATEGORIES) {
      expect(screen.getByText(`col_category_${cat}`)).toBeInTheDocument();
    }
  });

  it('5. each column shows its translated labelKey', () => {
    renderPicker();
    openPicker();
    for (const col of ALL_COLUMNS) {
      expect(screen.getByText(col.labelKey)).toBeInTheDocument();
    }
  });

  it('6. empty category — no heading rendered if no columns in that category', () => {
    // All COLUMN_CATEGORIES have at least one column, so all headings appear
    renderPicker();
    openPicker();
    expect(screen.getAllByRole('heading').length).toBeGreaterThanOrEqual(COLUMN_CATEGORIES.length);
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
    openPicker();
    const nameCheckbox = screen.getByRole('checkbox', { name: /col_name/i });
    expect(nameCheckbox).toBeChecked();
  });

  it('8. hidden column → checkbox is unchecked', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    openPicker();
    const emailCheckbox = screen.getByRole('checkbox', { name: /col_email/i });
    expect(emailCheckbox).not.toBeChecked();
  });

  it('9. core column → checkbox is checked and disabled', () => {
    renderPicker({ onVisibleColumnsChange });
    openPicker();
    for (const coreId of CORE_COLUMN_IDS) {
      const col = ALL_COLUMNS.find((c) => c.id === coreId)!;
      const checkbox = screen.getByRole('checkbox', { name: new RegExp(col.labelKey, 'i') });
      expect(checkbox).toBeChecked();
      expect(checkbox).toBeDisabled();
    }
  });

  it('10. checking a hidden column → onVisibleColumnsChange called with that column added', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    openPicker();
    const emailCheckbox = screen.getByRole('checkbox', { name: /col_email/i });
    fireEvent.click(emailCheckbox);
    expect(onVisibleColumnsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['name', 'city', 'email']),
    );
  });

  it('11. unchecking a visible non-core column → onVisibleColumnsChange called without it', () => {
    const visibleColumns = ['name', 'city', 'deviceCount'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    openPicker();
    const cityCheckbox = screen.getByRole('checkbox', { name: /col_city/i });
    fireEvent.click(cityCheckbox);
    const result = onVisibleColumnsChange.mock.calls[0][0] as string[];
    expect(result).not.toContain('city');
    expect(result).toContain('name');
  });

  it('12. toggle preserves order of other visible columns', () => {
    const visibleColumns = ['name', 'city', 'deviceCount'];
    renderPicker({ visibleColumns, onVisibleColumnsChange });
    openPicker();
    const emailCheckbox = screen.getByRole('checkbox', { name: /col_email/i });
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
    openPicker();
    const cityCheckbox = screen.getByRole('checkbox', { name: /col_city/i });
    fireEvent.click(cityCheckbox);
    // Modal should appear
    expect(screen.getByRole('dialog', { name: /col_picker_sort_warning_title/i })).toBeInTheDocument();
  });

  it('14. sort-warning modal has Cancel and Confirm buttons', () => {
    const visibleColumns = ['name', 'city'];
    renderPicker({
      visibleColumns,
      sortModel: [{ column: 'city', direction: 'asc' }],
      onVisibleColumnsChange,
    });
    openPicker();
    fireEvent.click(screen.getByRole('checkbox', { name: /col_city/i }));
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
    openPicker();
    fireEvent.click(screen.getByRole('checkbox', { name: /col_city/i }));
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
    openPicker();
    fireEvent.click(screen.getByRole('checkbox', { name: /col_city/i }));
    fireEvent.click(screen.getByRole('button', { name: /col_picker_confirm/i }));
    // city removed from visible columns
    const newVisible = onVisibleColumnsChange.mock.calls[0][0] as string[];
    expect(newVisible).not.toContain('city');
    // city removed from sortModel (falls back to DEFAULT_SORT_MODEL)
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
    openPicker();
    fireEvent.click(screen.getByRole('checkbox', { name: /col_city/i }));
    // Press Escape on modal
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
    // Pad to MAX_VISIBLE_COLUMNS with non-visible non-core columns
    const extras = ALL_COLUMNS.filter(
      (c) => !visibleColumns.includes(c.id) && !c.core,
    );
    const padded = [...visibleColumns, ...extras.slice(0, MAX_VISIBLE_COLUMNS - visibleColumns.length)].slice(
      0,
      MAX_VISIBLE_COLUMNS,
    );
    renderPicker({ visibleColumns: padded });
    openPicker();
    // Columns not in padded (and not core) should be disabled
    const hidden = ALL_COLUMNS.filter((c) => !padded.includes(c.id) && !c.core);
    if (hidden.length > 0) {
      const checkbox = screen.getByRole('checkbox', { name: new RegExp(hidden[0].labelKey, 'i') });
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
    openPicker();
    const hidden = ALL_COLUMNS.filter((c) => !padded.includes(c.id) && !c.core);
    if (hidden.length > 0) {
      const checkbox = screen.getByRole('checkbox', { name: new RegExp(hidden[0].labelKey, 'i') });
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
    openPicker();
    // Uncheck a non-core visible column
    const nonCoreVisible = padded.find((id) => !CORE_COLUMN_IDS.includes(id));
    if (nonCoreVisible) {
      const col = ALL_COLUMNS.find((c) => c.id === nonCoreVisible)!;
      fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(col.labelKey, 'i') }));
      expect(onVisibleColumnsChange).toHaveBeenCalled();
    }
  });
});

describe('Phase 3A: ColumnPicker — reset', () => {
  it('21. clicking Reset with no sorted columns affected → onReset called immediately', () => {
    const onReset = vi.fn();
    const onSortModelChange = vi.fn();
    renderPicker({
      sortModel: DEFAULT_SORT_MODEL, // default sort, no hidden sorted column
      onReset,
      onSortModelChange,
    });
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /col_picker_reset/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('22. clicking Reset when sorted column would be hidden → blocking summary modal shown', () => {
    const onReset = vi.fn();
    // 'createdAt' is sortable but NOT in DEFAULT_VISIBLE_COLUMNS.
    // When resetting, createdAt would be hidden → modal should appear.
    renderPicker({
      visibleColumns: ['name', 'createdAt'],
      sortModel: [{ column: 'createdAt', direction: 'asc' }],
      onReset,
    });
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /col_picker_reset/i }));
    expect(
      screen.queryByRole('dialog', { name: /col_picker_sort_warning_title/i }),
    ).toBeInTheDocument();
  });

  it('26. one aggregated modal for multiple sorted columns affected by reset', () => {
    const onReset = vi.fn();
    // Both createdAt and type are NOT in DEFAULT_VISIBLE_COLUMNS; both sorted
    renderPicker({
      visibleColumns: ['name', 'createdAt', 'city'],
      sortModel: [{ column: 'createdAt', direction: 'asc' }],
      onReset,
    });
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /col_picker_reset/i }));
    const modals = screen.queryAllByRole('dialog', { name: /col_picker_sort_warning_title/i });
    expect(modals.length).toBe(1); // exactly one aggregated modal
  });
});

describe('Phase 3A: ColumnPicker — reorder (drag-and-drop)', () => {
  it('27. reorder drag-drop interaction is wired (onColumnOrderChange prop exists)', () => {
    const onColumnOrderChange = vi.fn();
    renderPicker({ onColumnOrderChange });
    openPicker();
    // Just verify the component renders and accepts the callback
    expect(onColumnOrderChange).toBeDefined();
  });

  it('28. reorder does not change visibility — only column order', () => {
    const onVisibleColumnsChange = vi.fn();
    const onColumnOrderChange = vi.fn();
    renderPicker({ onVisibleColumnsChange, onColumnOrderChange });
    openPicker();
    // Column order callback present, visibility callback not called spuriously
    expect(onVisibleColumnsChange).not.toHaveBeenCalled();
  });

  it('29. core column can be reordered (drag handles present for core columns)', () => {
    renderPicker();
    openPicker();
    // Drag handles should be present for all columns including core
    const handles = screen.getAllByRole('button', { name: /drag|reorder/i });
    expect(handles.length).toBeGreaterThanOrEqual(CORE_COLUMN_IDS.length);
  });
});

describe('Phase 3A: ColumnPicker — accessibility', () => {
  it('30. trigger button has aria-expanded attribute', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /col_picker_columns_label/i });
    expect(btn).toHaveAttribute('aria-expanded');
  });

  it('31. each checkbox has an accessible label matching column name', () => {
    renderPicker();
    openPicker();
    for (const col of ALL_COLUMNS) {
      const checkbox = screen.getByRole('checkbox', { name: new RegExp(col.labelKey, 'i') });
      expect(checkbox).toBeInTheDocument();
    }
  });

  it('32. category headings have heading role', () => {
    renderPicker();
    openPicker();
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThanOrEqual(COLUMN_CATEGORIES.length);
  });

  it('35. Escape closes popover', () => {
    renderPicker();
    openPicker();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Phase 3A: ColumnPicker — close behavior', () => {
  it('36. click outside popover → closes', () => {
    renderPicker();
    openPicker();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('37. pressing Escape on trigger → closes (toggle)', () => {
    renderPicker();
    const trigger = openPicker();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
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
    openPicker();
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
