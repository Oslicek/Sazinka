/**
 * CustomerTable - Virtualized table for customer list
 *
 * Features:
 * - Virtualized rendering via react-virtuoso (handles 1000+ rows)
 * - Server-authoritative sorting: row order comes from backend response
 * - Sortable column headers with multi-level sort model (sortModel/onSortModelChange)
 * - Sort indicators: direction arrow + priority badge (1, 2, ...)
 * - Keyboard sort: Enter (primary), Shift+Enter (secondary)
 * - Row selection for preview panel
 * - Keyboard navigation (↑↓ rows)
 * - Infinite scroll (endReached callback)
 */

import { useMemo, useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, AlertTriangle, ClipboardCopy, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { TableVirtuoso } from 'react-virtuoso';
import type { CustomerListItem, ColumnFilter, ColumnDistinctRequest } from '@shared/customer';
import { formatDate } from '../../i18n/formatters';
import {
  ALL_COLUMNS,
  CORE_COLUMN_IDS,
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  sanitizeSortModel,
  sanitizeVisibleColumns,
  sanitizeColumnOrder,
} from '../../lib/customerColumns';
import type { SortEntry } from '../../lib/customerColumns';
import { ColumnFilterDropdown } from './ColumnFilterDropdown';
import styles from './CustomerTable.module.css';

const columnHelper = createColumnHelper<CustomerListItem>();

// Maps catalog ID → TanStack column ID (for backward-compat with sort indicators + tests)
const CATALOG_TO_TABLE_ID: Record<string, string> = {
  name: 'customer',
  nextRevision: 'nextRevisionDate',
};

// Maps TanStack column ID → catalog ID (reverse lookup for sort handler)
const TABLE_TO_CATALOG_ID: Record<string, string> = {
  customer: 'name',
  nextRevisionDate: 'nextRevision',
};

function getTableToCatalogId(tableId: string): string {
  return TABLE_TO_CATALOG_ID[tableId] ?? tableId;
}

interface CustomerTableProps {
  customers: CustomerListItem[];
  selectedId: string | null;
  onSelectCustomer: (customer: CustomerListItem | null) => void;
  onDoubleClick: (customer: CustomerListItem) => void;
  isLoading?: boolean;
  /** Called when user scrolls near the bottom; load more data */
  onEndReached?: () => void;
  /** True when a new page is currently being fetched */
  isLoadingMore?: boolean;
  /** Total number of customers on the server */
  totalCount?: number;
  /** Server-authoritative multi-level sort model */
  sortModel?: SortEntry[];
  /** Called when user interacts with a header to change sorting */
  onSortModelChange?: (model: SortEntry[]) => void;
  /** IDs of currently visible columns (Phase 3) */
  visibleColumns?: string[];
  /** Full column order (Phase 3) */
  columnOrder?: string[];
  /** Active column filters */
  columnFilters?: ColumnFilter[];
  /** Called when user applies or clears a column filter */
  onColumnFiltersChange?: (filters: ColumnFilter[]) => void;
  /** Context passed to distinct endpoint (search, revision chips, etc.) */
  distinctContext?: Omit<ColumnDistinctRequest, 'column'>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRevisionStatus(
  date: string | null,
  overdueCount: number,
  neverServicedCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { text: string; status: 'overdue' | 'never-serviced' | 'soon' | 'upcoming' | 'none' } {
  if (neverServicedCount > 0) {
    return { text: t('revision_no_revision', { count: neverServicedCount }), status: 'never-serviced' };
  }
  if (overdueCount > 0) {
    return { text: t('revision_overdue_count', { count: overdueCount }), status: 'overdue' };
  }
  if (!date) {
    if (neverServicedCount === 0 && overdueCount === 0) {
      return { text: t('revision_ok'), status: 'none' };
    }
    return { text: t('revision_no_revision_plain'), status: 'none' };
  }
  const dueDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { text: t('revision_overdue_days', { days: Math.abs(diffDays) }), status: 'overdue' };
  } else if (diffDays <= 7) {
    return { text: t('revision_in_days', { days: diffDays }), status: 'soon' };
  } else if (diffDays <= 30) {
    return { text: formatDate(dueDate), status: 'upcoming' };
  }
  return { text: formatDate(dueDate), status: 'none' };
}

function AddressStatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const config: Record<string, { icon: ReactNode; labelKey: string; className: string }> = {
    success: { icon: <Check size={14} />, labelKey: 'address_status_verified', className: styles.statusSuccess },
    pending: { icon: '⏳', labelKey: 'address_status_pending_short', className: styles.statusPending },
    failed: { icon: <AlertTriangle size={14} />, labelKey: 'address_status_failed_short', className: styles.statusFailed },
  };
  const { icon, labelKey, className } = config[status] || {
    icon: '⛔',
    labelKey: 'address_status_missing_short',
    className: styles.statusMissing,
  };
  return (
    <span className={`${styles.statusBadge} ${className}`} title={t(labelKey)}>
      {icon}
    </span>
  );
}

// ── Sort model interaction helpers ─────────────────────────────────────────────

/**
 * Apply a primary-sort click (no modifier key).
 * Cycle based on whether this column is already the primary (first) sort:
 * - Not primary → set as primary with ASC, replacing all other entries
 * - Primary ASC → toggle to DESC (still primary-only)
 * - Primary DESC → reset to DEFAULT_SORT_MODEL
 */
function applyPrimarySort(model: SortEntry[], columnId: string): SortEntry[] {
  const primary = model[0];
  if (primary?.column !== columnId) {
    return [{ column: columnId, direction: 'asc' }];
  }
  if (primary.direction === 'asc') {
    return [{ column: columnId, direction: 'desc' }];
  }
  return [...DEFAULT_SORT_MODEL];
}

/**
 * Apply a Shift+click (secondary sort) interaction.
 * If the raw model was empty, behave like primary sort (no prior preference).
 * Rules:
 * - If column is NOT in model: append with direction 'asc'.
 * - If column IS in model with 'asc': toggle to 'desc'.
 * - If column IS in model with 'desc': remove it.
 * - If removing would leave the model empty (single-entry): toggle instead of remove.
 */
function applyShiftSort(rawModel: SortEntry[], columnId: string): SortEntry[] {
  // Empty original → no existing preference → treat as primary sort
  if (!rawModel || rawModel.length === 0) {
    return [{ column: columnId, direction: 'asc' }];
  }

  const sanitized = sanitizeSortModel(rawModel);
  const existingIndex = sanitized.findIndex((e) => e.column === columnId);

  if (existingIndex === -1) {
    return [...sanitized, { column: columnId, direction: 'asc' }];
  }

  const existing = sanitized[existingIndex];
  if (existing.direction === 'asc') {
    const updated = [...sanitized];
    updated[existingIndex] = { column: columnId, direction: 'desc' };
    return updated;
  }

  // direction === 'desc' → would remove
  if (sanitized.length === 1) {
    // Last entry; toggle back to asc (canonical non-empty rule)
    return [{ column: columnId, direction: 'asc' }];
  }
  return sanitized.filter((e) => e.column !== columnId);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CustomerTable({
  customers,
  selectedId,
  onSelectCustomer,
  onDoubleClick,
  isLoading,
  onEndReached,
  isLoadingMore,
  totalCount,
  sortModel: sortModelProp = DEFAULT_SORT_MODEL,
  onSortModelChange,
  visibleColumns: visibleColumnsProp,
  columnOrder: columnOrderProp,
  columnFilters = [],
  onColumnFiltersChange,
  distinctContext,
}: CustomerTableProps) {
  const { t } = useTranslation('customers');

  // Which column's filter dropdown is currently open (catalog ID, or null)
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);

  // Quick lookup: column ID → active filter
  const activeFiltersByColumn = useMemo(() => {
    const map = new Map<string, ColumnFilter>();
    for (const f of columnFilters) map.set(f.column, f);
    return map;
  }, [columnFilters]);

  const handleFilterApply = useCallback((filter: ColumnFilter) => {
    if (!onColumnFiltersChange) return;
    const next = columnFilters.filter((f) => f.column !== filter.column);
    next.push(filter);
    onColumnFiltersChange(next);
    setOpenFilterColumn(null);
  }, [columnFilters, onColumnFiltersChange]);

  const handleFilterClear = useCallback((columnId: string) => {
    if (!onColumnFiltersChange) return;
    onColumnFiltersChange(columnFilters.filter((f) => f.column !== columnId));
    setOpenFilterColumn(null);
  }, [columnFilters, onColumnFiltersChange]);

  // Normalize the incoming sortModel (for display)
  const sortModel = useMemo(() => sanitizeSortModel(sortModelProp), [sortModelProp]);
  // Keep original prop for interaction logic (empty prop = no prior preference)
  const sortModelRaw = sortModelProp;

  // Compute effective visible columns (sanitized, with core ensured)
  const effectiveVisible = useMemo(
    () => sanitizeVisibleColumns(visibleColumnsProp ?? DEFAULT_VISIBLE_COLUMNS),
    [visibleColumnsProp],
  );
  // Compute effective column order
  const effectiveOrder = useMemo(
    () => sanitizeColumnOrder(columnOrderProp ?? DEFAULT_COLUMN_ORDER),
    [columnOrderProp],
  );

  // Ordered visible catalog IDs (order by effectiveOrder, filter to effectiveVisible + core)
  const orderedCatalogIds = useMemo(() => {
    const visibleSet = new Set(effectiveVisible);
    for (const coreId of CORE_COLUMN_IDS) visibleSet.add(coreId);
    return effectiveOrder.filter((id) => visibleSet.has(id));
  }, [effectiveVisible, effectiveOrder]);

  // Map catalog IDs to their sortable flag for quick lookup
  const sortableIds = useMemo(
    () => new Set(ALL_COLUMNS.filter((c) => c.sortable).map((c) => c.id)),
    [],
  );

  const handleHeaderInteraction = useCallback(
    (tableColId: string, shiftKey: boolean) => {
      if (!onSortModelChange) return;
      const catalogId = getTableToCatalogId(tableColId);
      if (!sortableIds.has(catalogId)) return;

      const nextModel = shiftKey
        ? applyShiftSort(sortModelRaw, catalogId)
        : applyPrimarySort(sortModel, catalogId);
      onSortModelChange(nextModel);
    },
    [onSortModelChange, sortModel, sortModelRaw, sortableIds],
  );

  const columns = useMemo(() => {
    return orderedCatalogIds.map((catalogId) => {
      const tableId = CATALOG_TO_TABLE_ID[catalogId] ?? catalogId;
      switch (catalogId) {
        case 'name':
          return columnHelper.accessor('name', {
            id: tableId,
            header: t('table_customer'),
            cell: ({ row }) => {
              const customer = row.original;
              return (
                <div className={styles.customerCell}>
                  <div className={styles.customerMain}>
                    <span className={styles.customerName}>
                      {customer.name}
                      <span className={styles.customerType}>
                        {customer.type === 'company' ? t('type_company') : t('type_person')}
                      </span>
                    </span>
                    <span className={styles.customerAddress}>
                      {customer.street && `${customer.street}, `}{customer.city}
                    </span>
                  </div>
                </div>
              );
            },
            size: 350,
          });
        case 'type':
          return columnHelper.accessor('type', {
            id: tableId,
            header: t('col_type'),
            cell: ({ getValue }) =>
              getValue() === 'company' ? t('type_company') : t('type_person'),
            size: 80,
          });
        case 'city':
          return columnHelper.accessor('city', {
            id: tableId,
            header: t('table_city'),
            cell: ({ getValue }) => getValue() || '-',
            size: 120,
          });
        case 'street':
          return columnHelper.accessor('street', {
            id: tableId,
            header: t('col_street'),
            cell: ({ getValue }) => getValue() || '-',
            size: 140,
          });
        case 'postalCode':
          return columnHelper.accessor('postalCode', {
            id: tableId,
            header: t('col_postal_code'),
            cell: ({ getValue }) => getValue() || '-',
            size: 80,
          });
        case 'phone':
          return columnHelper.accessor('phone', {
            id: tableId,
            header: t('col_phone'),
            cell: ({ getValue }) => getValue() || '-',
            size: 120,
          });
        case 'email':
          return columnHelper.accessor('email', {
            id: tableId,
            header: t('col_email'),
            cell: ({ getValue }) => getValue() || '-',
            size: 160,
          });
        case 'deviceCount':
          return columnHelper.accessor('deviceCount', {
            id: tableId,
            header: t('table_devices'),
            cell: ({ getValue }) => <span className={styles.deviceCount}>{getValue()}</span>,
            size: 80,
          });
        case 'nextRevision':
          return columnHelper.accessor('nextRevisionDate', {
            id: tableId,
            header: t('table_revision_status'),
            cell: ({ row }) => {
              const { text, status } = formatRevisionStatus(
                row.original.nextRevisionDate,
                row.original.overdueCount,
                row.original.neverServicedCount,
                t,
              );
              return (
                <span
                  className={`${styles.revisionStatus} ${
                    status === 'overdue'
                      ? styles.revisionOverdue
                      : status === 'never-serviced'
                      ? styles.revisionNeverServiced
                      : status === 'soon'
                      ? styles.revisionSoon
                      : ''
                  }`}
                >
                  {text}
                </span>
              );
            },
            size: 140,
          });
        case 'geocodeStatus':
          return columnHelper.accessor('geocodeStatus', {
            id: tableId,
            header: t('table_address'),
            cell: ({ getValue }) => <AddressStatusBadge status={getValue() ?? ''} t={t} />,
            size: 80,
          });
        case 'createdAt':
          return columnHelper.accessor('createdAt' as keyof CustomerListItem, {
            id: tableId,
            header: t('col_created_at'),
            cell: ({ getValue }) => {
              const v = getValue() as string | null | undefined;
              return v ? formatDate(new Date(v)) : '-';
            },
            size: 100,
          });
        default:
          return columnHelper.display({
            id: tableId,
            header: catalogId,
            cell: () => '-',
            size: 100,
          });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedCatalogIds, t]);

  const table = useReactTable({
    data: customers,
    columns,
    // No getSortedRowModel — server is authoritative for ordering
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;

  const handleRowClick = useCallback(
    (customer: CustomerListItem) => {
      if (selectedId === customer.id) {
        onSelectCustomer(null);
      } else {
        onSelectCustomer(customer);
      }
    },
    [selectedId, onSelectCustomer],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;
      const currentIndex = selectedId
        ? rows.findIndex((r) => r.original.id === selectedId)
        : -1;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          {
            const nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : 0;
            onSelectCustomer(rows[nextIndex].original);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          {
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : rows.length - 1;
            onSelectCustomer(rows[prevIndex].original);
          }
          break;
        case 'Enter':
          if (currentIndex >= 0) {
            onDoubleClick(rows[currentIndex].original);
          }
          break;
        case 'Escape':
          onSelectCustomer(null);
          break;
      }
    },
    [rows, selectedId, onSelectCustomer, onDoubleClick],
  );

  const allLoaded = totalCount !== undefined && customers.length >= totalCount;

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>{t('loading_customers')}</span>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className={styles.empty}>
        <ClipboardCopy size={16} className={styles.emptyIcon} />
        <p>{t('no_customers_match')}</p>
      </div>
    );
  }

  return (
    <div className={styles.tableContainer} tabIndex={0} onKeyDown={handleKeyDown}>
      <TableVirtuoso
        style={{ height: '100%' }}
        data={rows}
        endReached={() => {
          if (onEndReached && !isLoadingMore && !allLoaded) {
            onEndReached();
          }
        }}
        overscan={20}
        fixedHeaderContent={() =>
          table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const catalogId = getTableToCatalogId(header.id);
                const isSortable = sortableIds.has(catalogId);
                const sortIdx = sortModel.findIndex((e) => e.column === catalogId);
                const sortEntry = sortIdx >= 0 ? sortModel[sortIdx] : null;
                const ariaSortValue = sortEntry
                  ? sortEntry.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';

                const hasActiveFilter = activeFiltersByColumn.has(catalogId);
                const isFilterOpen = openFilterColumn === catalogId;

                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize(), position: 'relative' }}
                    className={`${styles.th} ${isSortable ? styles.sortable : ''}`}
                    aria-sort={isSortable ? ariaSortValue : undefined}
                    tabIndex={isSortable ? 0 : undefined}
                    onClick={(e) => handleHeaderInteraction(header.id, e.shiftKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleHeaderInteraction(header.id, e.shiftKey);
                      }
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {isSortable && sortEntry && (
                      <span className={styles.sortIndicator}>
                        <span data-sort-dir={sortEntry.direction}>
                          {sortEntry.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        </span>
                        <span
                          data-sort-priority
                          className={styles.sortPriority}
                        >
                          {String(sortIdx + 1)}
                        </span>
                      </span>
                    )}
                    {/* Filter icon — always visible, click opens filter dropdown */}
                    <button
                      type="button"
                      className={styles.filterButton}
                      data-filter-active={hasActiveFilter ? 'true' : 'false'}
                      aria-label={t('filter_column_label', { column: catalogId })}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenFilterColumn(isFilterOpen ? null : catalogId);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Filter size={10} />
                    </button>
                    {/* Filter dropdown */}
                    {isFilterOpen && onColumnFiltersChange && (
                      <ColumnFilterDropdown
                        columnId={catalogId}
                        currentFilter={activeFiltersByColumn.get(catalogId) ?? null}
                        contextRequest={distinctContext}
                        onApply={handleFilterApply}
                        onClear={() => handleFilterClear(catalogId)}
                        onClose={() => setOpenFilterColumn(null)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          ))
        }
        itemContent={(_index, row) => (
          <>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} style={{ width: cell.column.getSize() }}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </>
        )}
        components={{
          Table: (props) => <table {...props} className={styles.table} />,
          TableHead: (props) => <thead {...props} className={styles.thead} />,
          TableRow: ({ item: row, ...props }) => (
            <tr
              {...props}
              data-customer-id={row.original.id}
              className={`${styles.row} ${selectedId === row.original.id ? styles.selected : ''}`}
              onClick={() => handleRowClick(row.original)}
              onDoubleClick={() => onDoubleClick(row.original)}
            />
          ),
          TableFoot: () =>
            isLoadingMore ? (
              <tfoot>
                <tr>
                  <td colSpan={columns.length} className={styles.loadingMore}>
                    {t('table_loading_more')}
                  </td>
                </tr>
              </tfoot>
            ) : null,
        }}
      />
    </div>
  );
}
