/**
 * CustomerTable - Virtualized table for customer list
 * 
 * Features:
 * - Virtualized rendering via react-virtuoso (handles 1000+ rows)
 * - Rich cells with name + contact + address
 * - Sortable columns
 * - Row selection for preview panel
 * - Keyboard navigation
 * - Infinite scroll (endReached callback)
 */

import { useMemo, useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, AlertTriangle, ClipboardCopy, ArrowUp, ArrowDown } from 'lucide-react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { TableVirtuoso } from 'react-virtuoso';
import type { CustomerListItem } from '@shared/customer';
import { formatDate } from '../../i18n/formatters';
import styles from './CustomerTable.module.css';

const columnHelper = createColumnHelper<CustomerListItem>();

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
}

// Format revision status for display
function formatRevisionStatus(
  date: string | null, 
  overdueCount: number,
  neverServicedCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { text: string; status: 'overdue' | 'never-serviced' | 'soon' | 'upcoming' | 'none' } {
  // Never serviced takes priority - show warning
  if (neverServicedCount > 0) {
    return { 
      text: t('revision_no_revision', { count: neverServicedCount }), 
      status: 'never-serviced'
    };
  }
  
  // Has overdue devices
  if (overdueCount > 0) {
    return { 
      text: t('revision_overdue_count', { count: overdueCount }), 
      status: 'overdue'
    };
  }

  if (!date) {
    // No upcoming revision date. If no warnings either, all devices are properly serviced.
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
    return { 
      text: t('revision_overdue_days', { days: Math.abs(diffDays) }), 
      status: 'overdue'
    };
  } else if (diffDays <= 7) {
    return { 
      text: t('revision_in_days', { days: diffDays }), 
      status: 'soon'
    };
  } else if (diffDays <= 30) {
    return { 
      text: formatDate(dueDate), 
      status: 'upcoming'
    };
  }
  
  return { 
    text: formatDate(dueDate), 
    status: 'none'
  };
}

// Address status badge
function AddressStatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const config: Record<string, { icon: ReactNode; labelKey: string; className: string }> = {
    success: { icon: <Check size={14} />, labelKey: 'address_status_verified', className: styles.statusSuccess },
    pending: { icon: '⏳', labelKey: 'address_status_pending_short', className: styles.statusPending },
    failed: { icon: <AlertTriangle size={14} />, labelKey: 'address_status_failed_short', className: styles.statusFailed },
  };
  
  const { icon, labelKey, className } = config[status] || { icon: '⛔', labelKey: 'address_status_missing_short', className: styles.statusMissing };
  
  return (
    <span className={`${styles.statusBadge} ${className}`} title={t(labelKey)}>
      {icon}
    </span>
  );
}

export function CustomerTable({
  customers,
  selectedId,
  onSelectCustomer,
  onDoubleClick,
  isLoading,
  onEndReached,
  isLoadingMore,
  totalCount,
}: CustomerTableProps) {
  const { t } = useTranslation('customers');

  const columns = useMemo(() => [
    columnHelper.accessor('name', {
      id: 'customer',
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
            <div className={styles.customerContact}>
              {customer.phone && <span className={styles.phone}>{customer.phone}</span>}
              {customer.email && <span className={styles.email}>{customer.email}</span>}
            </div>
          </div>
        );
      },
      size: 350,
    }),
    columnHelper.accessor('city', {
      header: t('table_city'),
      cell: ({ getValue }) => getValue() || '-',
      size: 120,
    }),
    columnHelper.accessor('deviceCount', {
      header: t('table_devices'),
      cell: ({ getValue }) => (
        <span className={styles.deviceCount}>{getValue()}</span>
      ),
      size: 80,
    }),
    columnHelper.accessor('nextRevisionDate', {
      header: t('table_revision_status'),
      cell: ({ row }) => {
        const { text, status } = formatRevisionStatus(
          row.original.nextRevisionDate,
          row.original.overdueCount,
          row.original.neverServicedCount,
          t,
        );
        return (
          <span className={`${styles.revision} ${styles[`revision-${status}`]}`}>
            {text}
          </span>
        );
      },
      size: 170,
    }),
    columnHelper.accessor('geocodeStatus', {
      header: t('table_address'),
      cell: ({ getValue }) => <AddressStatusBadge status={getValue()} t={t} />,
      size: 70,
    }),
  ], [t]);

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: customers,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  // Handle row click
  const handleRowClick = useCallback((customer: CustomerListItem) => {
    if (selectedId === customer.id) {
      onSelectCustomer(null);
    } else {
      onSelectCustomer(customer);
    }
  }, [selectedId, onSelectCustomer]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (rows.length === 0) return;

    const currentIndex = selectedId 
      ? rows.findIndex(r => r.original.id === selectedId)
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
  }, [rows, selectedId, onSelectCustomer, onDoubleClick]);

  // Whether all data has been loaded
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
          table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className={`${styles.th} ${header.column.getCanSort() ? styles.sortable : ''}`}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() && (
                    <span className={styles.sortIndicator}>
                      {header.column.getIsSorted() === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          ))
        }
        itemContent={(_index, row) => (
          <>
            {row.getVisibleCells().map(cell => (
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
