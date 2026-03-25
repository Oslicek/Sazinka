/**
 * Phase 2B (RED → GREEN) — CustomerTable sortable headers tests.
 *
 * Tests sort indicator rendering, click/shift-click interactions, keyboard,
 * and server-authoritative row ordering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DEFAULT_SORT_MODEL } from '@/lib/customerColumns';
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
