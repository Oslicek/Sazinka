/**
 * CustomerTable - TanStack Table implementation for customer list
 * 
 * Features:
 * - Rich cells with name + contact + address
 * - Sortable columns
 * - Row selection for preview panel
 * - Keyboard navigation
 */

import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import type { CustomerListItem } from '@shared/customer';
import styles from './CustomerTable.module.css';

const columnHelper = createColumnHelper<CustomerListItem>();

interface CustomerTableProps {
  customers: CustomerListItem[];
  selectedId: string | null;
  onSelectCustomer: (customer: CustomerListItem | null) => void;
  onDoubleClick: (customer: CustomerListItem) => void;
  isLoading?: boolean;
}

// Format revision status for display
function formatRevisionStatus(
  date: string | null, 
  overdueCount: number,
  neverServicedCount: number
): { text: string; status: 'overdue' | 'never-serviced' | 'soon' | 'upcoming' | 'none' } {
  // Never serviced takes priority - show warning
  if (neverServicedCount > 0) {
    return { 
      text: `Dosud nerevidováno (${neverServicedCount})`, 
      status: 'never-serviced'
    };
  }
  
  // Has overdue devices
  if (overdueCount > 0) {
    return { 
      text: `Po termínu (${overdueCount} zař.)`, 
      status: 'overdue'
    };
  }

  if (!date) {
    return { text: 'Bez revize', status: 'none' };
  }
  
  const dueDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return { 
      text: `Po termínu (${Math.abs(diffDays)} dní)`, 
      status: 'overdue'
    };
  } else if (diffDays <= 7) {
    return { 
      text: `Za ${diffDays} dní`, 
      status: 'soon'
    };
  } else if (diffDays <= 30) {
    return { 
      text: dueDate.toLocaleDateString('cs-CZ'), 
      status: 'upcoming'
    };
  }
  
  return { 
    text: dueDate.toLocaleDateString('cs-CZ'), 
    status: 'none'
  };
}

// Address status badge
function AddressStatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: string; label: string; className: string }> = {
    success: { icon: '✅', label: 'Ověřeno', className: styles.statusSuccess },
    pending: { icon: '⏳', label: 'Čeká', className: styles.statusPending },
    failed: { icon: '⚠', label: 'Nelze', className: styles.statusFailed },
  };
  
  const { icon, label, className } = config[status] || { icon: '⛔', label: 'Chybí', className: styles.statusMissing };
  
  return (
    <span className={`${styles.statusBadge} ${className}`} title={label}>
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
}: CustomerTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);

  const columns = useMemo(() => [
    columnHelper.accessor('name', {
      id: 'customer',
      header: 'Zákazník',
      cell: ({ row }) => {
        const customer = row.original;
        return (
          <div className={styles.customerCell}>
            <div className={styles.customerMain}>
              <span className={styles.customerName}>
                {customer.name}
                <span className={styles.customerType}>
                  {customer.type === 'company' ? 'Firma' : 'Osoba'}
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
      header: 'Město',
      cell: ({ getValue }) => getValue() || '-',
      size: 120,
    }),
    columnHelper.accessor('deviceCount', {
      header: 'Zařízení',
      cell: ({ getValue }) => (
        <span className={styles.deviceCount}>{getValue()}</span>
      ),
      size: 80,
    }),
    columnHelper.accessor('nextRevisionDate', {
      header: 'Stav revizí',
      cell: ({ row }) => {
        const { text, status } = formatRevisionStatus(
          row.original.nextRevisionDate,
          row.original.overdueCount,
          row.original.neverServicedCount
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
      header: 'Adresa',
      cell: ({ getValue }) => <AddressStatusBadge status={getValue()} />,
      size: 70,
    }),
  ], []);

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: customers,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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
    const rows = table.getRowModel().rows;
    if (rows.length === 0) return;

    const currentIndex = selectedId 
      ? rows.findIndex(r => r.original.id === selectedId)
      : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        const nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : 0;
        onSelectCustomer(rows[nextIndex].original);
        break;
      case 'ArrowUp':
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : rows.length - 1;
        onSelectCustomer(rows[prevIndex].original);
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
  }, [table, selectedId, onSelectCustomer, onDoubleClick]);

  // Scroll selected row into view
  useEffect(() => {
    if (!selectedId || !tableRef.current) return;
    
    const selectedRow = tableRef.current.querySelector(`[data-customer-id="${selectedId}"]`);
    if (selectedRow) {
      selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedId]);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Načítám zákazníky...</span>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>📋</span>
        <p>Žádní zákazníci neodpovídají filtrům</p>
      </div>
    );
  }

  return (
    <div className={styles.tableContainer} tabIndex={0} onKeyDown={handleKeyDown}>
      <table ref={tableRef} className={styles.table}>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className={header.column.getCanSort() ? styles.sortable : ''}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() && (
                    <span className={styles.sortIndicator}>
                      {header.column.getIsSorted() === 'asc' ? ' ↑' : ' ↓'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              data-customer-id={row.original.id}
              className={`${styles.row} ${selectedId === row.original.id ? styles.selected : ''}`}
              onClick={() => handleRowClick(row.original)}
              onDoubleClick={() => onDoubleClick(row.original)}
            >
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} style={{ width: cell.column.getSize() }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
