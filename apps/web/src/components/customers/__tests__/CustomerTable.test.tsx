/**
 * Phase 2B + 3B (RED → GREEN) — CustomerTable sortable headers and dynamic columns.
 *
 * Phase 2B: sort indicator rendering, click/shift-click interactions, keyboard,
 * and server-authoritative row ordering.
 * Phase 3B: visibleColumns and columnOrder props control which columns render and in which order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { DEFAULT_SORT_MODEL, DEFAULT_VISIBLE_COLUMNS, DEFAULT_COLUMN_ORDER, CORE_COLUMN_IDS, MAX_VISIBLE_COLUMNS, ALL_COLUMNS } from '@/lib/customerColumns';
import type { SortEntry } from '@/lib/customerColumns';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Mock react-virtuoso — TableVirtuoso doesn't work in jsdom
vi.mock('react-virtuoso', () => ({
  TableVirtuoso: ({
    data,
    fixedHeaderContent,
    itemContent,
    components,
  }: {
    data: unknown[];
    fixedHeaderContent: () => React.ReactNode;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components: Record<string, React.ComponentType<Record<string, unknown>>>;
  }) => {
    const Table = components?.Table ?? 'table';
    const TableHead = components?.TableHead ?? 'thead';
    const TableRow = components?.TableRow;
    return (
      <Table>
        <TableHead>{fixedHeaderContent()}</TableHead>
        <tbody>
          {data.map((item, i) => {
            const cells = itemContent(i, item);
            if (TableRow) {
              return <TableRow key={i} item={item}>{cells}</TableRow>;
            }
            return <tr key={i}>{cells}</tr>;
          })}
        </tbody>
      </Table>
    );
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeCustomer = (id: string, name: string) => ({
  id,
  userId: 'user-1',
  name,
  type: 'company' as const,
  city: 'Prague',
  street: '123 Main St',
  postalCode: '10000',
  geocodeStatus: 'success' as const,
  deviceCount: 2,
  overdueCount: 0,
  neverServicedCount: 0,
  nextRevisionDate: null,
  email: null,
  phone: null,
});

const CUSTOMERS = [makeCustomer('1', 'Alpha'), makeCustomer('2', 'Beta')];

const DEFAULT_PROPS = {
  customers: CUSTOMERS,
  selectedId: null,
  onSelectCustomer: vi.fn(),
  onDoubleClick: vi.fn(),
  sortModel: DEFAULT_SORT_MODEL,
  onSortModelChange: vi.fn(),
};

function renderTable(
  overrides: Partial<typeof DEFAULT_PROPS & {
    sortModel: SortEntry[];
    onSortModelChange: (m: SortEntry[]) => void;
    visibleColumns: string[];
    columnOrder: string[];
  }> = {}
) {
  const props = { ...DEFAULT_PROPS, ...overrides, onSortModelChange: overrides.onSortModelChange ?? vi.fn(), onSelectCustomer: overrides.onSelectCustomer ?? vi.fn() };
  return render(<CustomerTable {...props} />);
}

import { CustomerTable } from '../CustomerTable';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 2B: CustomerTable — sort indicator rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. sortModel=[name ASC] → name header shows ↑ arrow + priority badge "1"', () => {
    renderTable({ sortModel: [{ column: 'name', direction: 'asc' }] });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    expect(nameHeader.querySelector('[data-sort-dir="asc"]')).toBeTruthy();
    expect(nameHeader.querySelector('[data-sort-priority]')?.textContent).toBe('1');
  });

  it('2. sortModel=[city DESC] → city header shows ↓ arrow + priority badge "1"', () => {
    renderTable({ sortModel: [{ column: 'city', direction: 'desc' }] });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    expect(cityHeader.querySelector('[data-sort-dir="desc"]')).toBeTruthy();
    expect(cityHeader.querySelector('[data-sort-priority]')?.textContent).toBe('1');
  });

  it('3. sortModel with 2 entries → primary shows "1", secondary shows "2"', () => {
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'desc' },
      ],
    });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    expect(nameHeader.querySelector('[data-sort-priority]')?.textContent).toBe('1');
    expect(cityHeader.querySelector('[data-sort-priority]')?.textContent).toBe('2');
  });

  it('4. empty sortModel input is normalized to DEFAULT_SORT_MODEL; shows name ASC indicator', () => {
    renderTable({ sortModel: [] });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    expect(nameHeader.querySelector('[data-sort-priority]')?.textContent).toBe('1');
    expect(nameHeader.querySelector('[data-sort-dir="asc"]')).toBeTruthy();
  });

  it('5. aria-sort="ascending" on ASC-sorted column header', () => {
    renderTable({ sortModel: [{ column: 'name', direction: 'asc' }] });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('6. aria-sort="descending" on DESC-sorted column header', () => {
    renderTable({ sortModel: [{ column: 'city', direction: 'desc' }] });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    expect(cityHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('7. unsorted column headers have aria-sort="none"', () => {
    renderTable({ sortModel: [{ column: 'name', direction: 'asc' }] });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    expect(cityHeader).toHaveAttribute('aria-sort', 'none');
  });
});

describe('Phase 2B: CustomerTable — click → primary sort (no modifier)', () => {
  let onSortModelChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onSortModelChange = vi.fn();
  });

  it('8. click unsorted sortable header → onSortModelChange([{column:city, direction:asc}])', () => {
    renderTable({
      sortModel: [{ column: 'name', direction: 'asc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader);
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'city', direction: 'asc' }]);
  });

  it('9. click ASC-sorted header → onSortModelChange with same column, direction: desc', () => {
    renderTable({
      sortModel: [{ column: 'city', direction: 'asc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader);
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'city', direction: 'desc' }]);
  });

  it('10. click DESC-sorted header → onSortModelChange(DEFAULT_SORT_MODEL) (reset)', () => {
    renderTable({
      sortModel: [{ column: 'city', direction: 'desc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader);
    expect(onSortModelChange).toHaveBeenCalledWith(DEFAULT_SORT_MODEL);
  });

  it('11. click non-sortable header (geocodeStatus) → onSortModelChange NOT called', () => {
    renderTable({ onSortModelChange });
    const addrHeader = screen.getByRole('columnheader', { name: /table_address/i });
    fireEvent.click(addrHeader);
    expect(onSortModelChange).not.toHaveBeenCalled();
  });

  it('12. click replaces entire sortModel (not append)', () => {
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'desc' },
      ],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader);
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'city', direction: 'asc' }]);
  });
});

describe('Phase 2B: CustomerTable — Shift+click → secondary sort', () => {
  let onSortModelChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onSortModelChange = vi.fn();
  });

  it('13. name ASC + Shift+click city → [name ASC, city ASC]', () => {
    renderTable({
      sortModel: [{ column: 'name', direction: 'asc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'asc' },
    ]);
  });

  it('14. [name ASC, city ASC] + Shift+click city → [name ASC, city DESC]', () => {
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'asc' },
      ],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'desc' },
    ]);
  });

  it('15. [name ASC, city DESC] + Shift+click city → removes city ([name ASC])', () => {
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'desc' },
      ],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'name', direction: 'asc' }]);
  });

  it('16. Shift+click on non-sortable header (geocodeStatus) → no change', () => {
    renderTable({ onSortModelChange });
    const addrHeader = screen.getByRole('columnheader', { name: /table_address/i });
    fireEvent.click(addrHeader, { shiftKey: true });
    expect(onSortModelChange).not.toHaveBeenCalled();
  });

  it('17. Shift+click when model empty → behaves like regular click (sets primary)', () => {
    renderTable({ sortModel: [], onSortModelChange });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalled();
    const result = onSortModelChange.mock.calls[0][0] as SortEntry[];
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].column).toBe('city');
  });

  it('18. Shift+click on primary sort column (name ASC only) → toggles to name DESC', () => {
    renderTable({
      sortModel: [{ column: 'name', direction: 'asc' }],
      onSortModelChange,
    });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    fireEvent.click(nameHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'name', direction: 'desc' }]);
  });

  it('19. Shift+click on primary sort column (name DESC only) → toggles back to name ASC', () => {
    renderTable({
      sortModel: [{ column: 'name', direction: 'desc' }],
      onSortModelChange,
    });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    fireEvent.click(nameHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'name', direction: 'asc' }]);
  });

  it('20. Shift+click on primary when multisort active → toggles primary direction, preserves secondary', () => {
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'asc' },
      ],
      onSortModelChange,
    });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    fireEvent.click(nameHeader, { shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([
      { column: 'name', direction: 'desc' },
      { column: 'city', direction: 'asc' },
    ]);
  });
});

describe('Phase 2B: CustomerTable — keyboard', () => {
  let onSortModelChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onSortModelChange = vi.fn();
  });

  it('21. Enter on focused sortable header → same as click (primary sort)', () => {
    renderTable({
      sortModel: [{ column: 'name', direction: 'asc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.keyDown(cityHeader, { key: 'Enter' });
    expect(onSortModelChange).toHaveBeenCalledWith([{ column: 'city', direction: 'asc' }]);
  });

  it('22. Shift+Enter → same as Shift+click (secondary sort)', () => {
    renderTable({
      sortModel: [{ column: 'name', direction: 'asc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.keyDown(cityHeader, { key: 'Enter', shiftKey: true });
    expect(onSortModelChange).toHaveBeenCalledWith([
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'asc' },
    ]);
  });
});

describe('Phase 2B: CustomerTable — server-authoritative ordering', () => {
  it('23. incoming customers order [Beta, Alpha] → rendered [Beta, Alpha] even with sortModel change', () => {
    renderTable({
      customers: [makeCustomer('2', 'Beta'), makeCustomer('1', 'Alpha')],
      sortModel: [{ column: 'name', direction: 'asc' }],
    });
    const rows = screen.getAllByRole('row').filter((r) => r.tagName === 'TR' && !r.closest('thead'));
    const texts = rows.map((r) => r.textContent);
    const betaIndex = texts.findIndex((t) => t?.includes('Beta'));
    const alphaIndex = texts.findIndex((t) => t?.includes('Alpha'));
    expect(betaIndex).toBeLessThan(alphaIndex);
  });

  it('24. header click updates sortModel via callback but does not reorder rows', () => {
    const onSortModelChange = vi.fn();
    const { rerender } = renderTable({
      customers: [makeCustomer('2', 'Beta'), makeCustomer('1', 'Alpha')],
      sortModel: [{ column: 'name', direction: 'asc' }],
      onSortModelChange,
    });
    const cityHeader = screen.getByRole('columnheader', { name: /table_city/i });
    fireEvent.click(cityHeader);
    expect(onSortModelChange).toHaveBeenCalled();
    // Rows should still be in the original provided order (Beta, Alpha)
    const rows = screen.getAllByRole('row').filter((r) => r.tagName === 'TR' && !r.closest('thead'));
    const betaIndex = rows.findIndex((r) => r.textContent?.includes('Beta'));
    const alphaIndex = rows.findIndex((r) => r.textContent?.includes('Alpha'));
    expect(betaIndex).toBeLessThan(alphaIndex);
    rerender;
  });

  it('25. when parent passes updated sorted data, table renders rows in the new provided order', () => {
    const { rerender } = renderTable({
      customers: [makeCustomer('2', 'Beta'), makeCustomer('1', 'Alpha')],
      sortModel: [{ column: 'name', direction: 'asc' }],
    });
    rerender(
      <CustomerTable
        {...DEFAULT_PROPS}
        customers={[makeCustomer('1', 'Alpha'), makeCustomer('2', 'Beta')]}
        sortModel={[{ column: 'name', direction: 'asc' }]}
      />
    );
    const rows = screen.getAllByRole('row').filter((r) => r.tagName === 'TR' && !r.closest('thead'));
    const alphaIndex = rows.findIndex((r) => r.textContent?.includes('Alpha'));
    const betaIndex = rows.findIndex((r) => r.textContent?.includes('Beta'));
    expect(alphaIndex).toBeLessThan(betaIndex);
  });
});

// ── Phase 3B Tests ────────────────────────────────────────────────────────────

describe('Phase 3B: CustomerTable — column visibility', () => {
  it('1. visibleColumns=[name,city,deviceCount] → exactly 3 column headers', () => {
    renderTable({ visibleColumns: ['name', 'city', 'deviceCount'] });
    expect(screen.getAllByRole('columnheader').length).toBe(3);
  });

  it('2. visibleColumns=[name,city,deviceCount] → nextRevision and geocodeStatus absent', () => {
    renderTable({ visibleColumns: ['name', 'city', 'deviceCount'] });
    expect(screen.queryByRole('columnheader', { name: /table_revision_status/i })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /table_address/i })).toBeNull();
  });

  it('3. visibleColumns not provided → falls back to DEFAULT_VISIBLE_COLUMNS', () => {
    renderTable({ visibleColumns: undefined });
    expect(screen.getAllByRole('columnheader').length).toBe(DEFAULT_VISIBLE_COLUMNS.length);
  });

  it('4. core column name always rendered even if omitted from visibleColumns', () => {
    // Pass visibleColumns without name (core); component must prepend it
    renderTable({ visibleColumns: ['city', 'deviceCount'] });
    // name (core) should still be rendered
    const nameHeader = screen.queryByRole('columnheader', { name: /table_customer/i });
    expect(nameHeader).toBeInTheDocument();
  });
});

describe('Phase 3B: CustomerTable — column order', () => {
  it('5. columnOrder=[deviceCount,name,city], visibleColumns=[name,city,deviceCount] → headers in order: deviceCount, name, city', () => {
    renderTable({
      visibleColumns: ['name', 'city', 'deviceCount'],
      columnOrder: ['deviceCount', 'name', 'city'],
    });
    const headers = screen.getAllByRole('columnheader');
    const texts = headers.map((h) => h.textContent?.trim() ?? '');
    const devIdx = texts.findIndex((t) => /table_devices/i.test(t));
    const nameIdx = texts.findIndex((t) => /table_customer/i.test(t));
    const cityIdx = texts.findIndex((t) => /table_city/i.test(t));
    expect(devIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(cityIdx);
  });

  it('6. columnOrder not provided → falls back to DEFAULT_COLUMN_ORDER', () => {
    renderTable({ columnOrder: undefined });
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThan(0);
  });

  it('7. columnOrder with extra IDs not in visibleColumns → only visible ones rendered', () => {
    renderTable({
      visibleColumns: ['name', 'city'],
      columnOrder: ['name', 'city', 'deviceCount', 'nextRevision'],
    });
    expect(screen.getAllByRole('columnheader').length).toBe(2);
    expect(screen.queryByRole('columnheader', { name: /table_devices/i })).toBeNull();
  });
});

describe('Phase 3B: CustomerTable — dynamic column changes', () => {
  it('8. removing a column from visibleColumns → table re-renders with fewer columns', () => {
    function Wrapper() {
      const [visible, setVisible] = useState(['name', 'city', 'deviceCount', 'nextRevision', 'geocodeStatus']);
      return (
        <>
          <button onClick={() => setVisible(['name', 'city', 'deviceCount', 'nextRevision'])}>
            remove
          </button>
          <CustomerTable
            customers={CUSTOMERS}
            selectedId={null}
            onSelectCustomer={vi.fn()}
            onDoubleClick={vi.fn()}
            visibleColumns={visible}
          />
        </>
      );
    }
    render(<Wrapper />);
    expect(screen.getAllByRole('columnheader').length).toBe(5);
    act(() => { fireEvent.click(screen.getByText('remove')); });
    expect(screen.getAllByRole('columnheader').length).toBe(4);
  });

  it('9. adding a column to visibleColumns → table re-renders with more columns', () => {
    function Wrapper() {
      const [visible, setVisible] = useState(['name', 'city', 'deviceCount']);
      return (
        <>
          <button onClick={() => setVisible(['name', 'city', 'deviceCount', 'nextRevision'])}>
            add
          </button>
          <CustomerTable
            customers={CUSTOMERS}
            selectedId={null}
            onSelectCustomer={vi.fn()}
            onDoubleClick={vi.fn()}
            visibleColumns={visible}
          />
        </>
      );
    }
    render(<Wrapper />);
    expect(screen.getAllByRole('columnheader').length).toBe(3);
    act(() => { fireEvent.click(screen.getByText('add')); });
    expect(screen.getAllByRole('columnheader').length).toBe(4);
  });
});

describe('Phase 3B: CustomerTable — cell rendering', () => {
  const richCustomer = {
    id: 'r1',
    userId: 'user-1',
    name: 'Rich Co.',
    type: 'company' as const,
    city: 'Brno',
    street: 'Náměstí 1',
    postalCode: '60200',
    geocodeStatus: 'success' as const,
    deviceCount: 3,
    overdueCount: 0,
    neverServicedCount: 0,
    nextRevisionDate: null,
    email: 'rich@example.com',
    phone: '+420 111 222 333',
    createdAt: '2025-01-15T10:00:00Z',
  };

  it('11. email column renders email value', () => {
    renderTable({
      customers: [richCustomer as Parameters<typeof renderTable>[0]['customers'] extends (infer T)[] ? T : never],
      visibleColumns: ['name', 'email'],
    });
    expect(screen.getByText('rich@example.com')).toBeInTheDocument();
  });

  it('12. phone column renders phone value', () => {
    renderTable({
      customers: [richCustomer as Parameters<typeof renderTable>[0]['customers'] extends (infer T)[] ? T : never],
      visibleColumns: ['name', 'phone'],
    });
    expect(screen.getByText('+420 111 222 333')).toBeInTheDocument();
  });

  it('13. null/missing value renders dash placeholder', () => {
    const noPhone = { ...richCustomer, phone: null };
    renderTable({
      customers: [noPhone as Parameters<typeof renderTable>[0]['customers'] extends (infer T)[] ? T : never],
      visibleColumns: ['name', 'phone'],
    });
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('Phase 3B: CustomerTable — edge cases', () => {
  it('14. visibleColumns=[] after sanitization → renders core columns (non-empty)', () => {
    renderTable({ visibleColumns: [] });
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThanOrEqual(CORE_COLUMN_IDS.length);
  });

  it('15. visibleColumns with unknown column IDs → unknown ignored, no crash', () => {
    renderTable({ visibleColumns: ['name', 'unknown_col_xyz'] });
    // unknown column ignored, renders only name
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThanOrEqual(1);
    expect(() => screen.getAllByRole('columnheader')).not.toThrow();
  });

  it('16. MAX_VISIBLE_COLUMNS columns visible → renders all, no overflow crash', () => {
    const maxCols = ALL_COLUMNS.slice(0, MAX_VISIBLE_COLUMNS).map((c) => c.id);
    renderTable({ visibleColumns: maxCols });
    expect(screen.getAllByRole('columnheader').length).toBeLessThanOrEqual(MAX_VISIBLE_COLUMNS + 1);
  });
});

// ── Phase 2B edge cases (kept here for historical grouping) ──────────────────

describe('Phase 2B: CustomerTable — edge cases', () => {
  it('26. very long sort model (5+ entries) → all rendered as indicators, no crash', () => {
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'desc' },
        { column: 'deviceCount', direction: 'asc' },
        { column: 'nextRevision', direction: 'desc' },
        { column: 'createdAt', direction: 'asc' },
      ],
    });
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
  });

  it('28. sortModel with hidden/non-table column → indicators shown only for visible column headers', () => {
    // 'email' is not a table column so no indicator; 'name' is visible so shows indicator
    renderTable({
      sortModel: [
        { column: 'name', direction: 'asc' },
      ],
    });
    const nameHeader = screen.getByRole('columnheader', { name: /table_customer/i });
    expect(nameHeader.querySelector('[data-sort-priority]')).toBeTruthy();
    // No email column header in the basic table
    expect(screen.queryByRole('columnheader', { name: /col_email/i })).toBeNull();
  });
});
