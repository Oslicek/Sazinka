/**
 * CSV Export Service
 * 
 * Provides export functionality for customers and revisions
 */

import type { Customer } from '@shared/customer';
import * as customerService from './customerService';
import * as revisionService from './revisionService';
import { useNatsStore } from '../stores/natsStore';
import i18n from '../i18n';


// ============================================================================
// CSV Helpers
// ============================================================================

/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 */
function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  
  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Convert an array of objects to CSV string
 */
function toCSV<T extends Record<string, unknown>>(
  data: T[],
  headers: { key: keyof T; label: string }[]
): string {
  const headerRow = headers.map(h => escapeCSV(h.label)).join(',');
  
  const dataRows = data.map(row => 
    headers.map(h => escapeCSV(row[h.key] as string | number)).join(',')
  );
  
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Trigger download of a CSV file
 */
function downloadCSV(content: string, filename: string): void {
  // Add BOM for UTF-8 encoding (Excel compatibility)
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

// ============================================================================
// Customer Export
// ============================================================================

/**
 * Customer export headers (matching import format) — resolved at call time for i18n
 */
function getCustomerHeaders() {
  const t = (key: string) => i18n.t(key);
  return [
    { key: 'name' as const, label: t('common:export_headers.name') },
    { key: 'street' as const, label: t('common:export_headers.street') },
    { key: 'city' as const, label: t('common:export_headers.city') },
    { key: 'postalCode' as const, label: t('common:export_headers.postal_code') },
    { key: 'email' as const, label: t('common:export_headers.email') },
    { key: 'phone' as const, label: t('common:export_headers.phone') },
    { key: 'notes' as const, label: t('common:export_headers.notes') },
  ];
}

interface CustomerExportRow {
  name: string;
  street: string;
  city: string;
  postalCode: string;
  email: string;
  phone: string;
  notes: string;
}

/**
 * Export all customers to CSV
 */
export async function exportCustomers(
  deps = { 
    listCustomers: customerService.listCustomers,
    request: useNatsStore.getState().request,
  }
): Promise<void> {
  // Fetch all customers
  const result = await deps.listCustomers({});
  const customers = result.items;
  
  // Map to export format
  const rows: CustomerExportRow[] = customers.map((c: Customer) => ({
    name: c.name,
    street: c.street || '',
    city: c.city || '',
    postalCode: c.postalCode || '',
    email: c.email || '',
    phone: c.phone || '',
    notes: c.notes || '',
  }));
  
  // Generate CSV
  const csv = toCSV(rows as unknown as Record<string, unknown>[], getCustomerHeaders());
  
  // Download
  const date = new Date().toISOString().slice(0, 10);
  downloadCSV(csv, `zakaznici-${date}.csv`);
}

// ============================================================================
// Revision Export
// ============================================================================

/**
 * Revision export headers — resolved at call time for i18n
 */
function getRevisionHeaders() {
  const t = (key: string) => i18n.t(key);
  return [
    { key: 'customerName' as const, label: t('common:export_headers.customer_name') },
    { key: 'deviceName' as const, label: t('common:export_headers.device_name') },
    { key: 'street' as const, label: t('common:export_headers.street') },
    { key: 'city' as const, label: t('common:export_headers.city') },
    { key: 'dueDate' as const, label: t('common:export_headers.due_date') },
    { key: 'status' as const, label: t('common:export_headers.status') },
    { key: 'scheduledDate' as const, label: t('common:export_headers.scheduled_date') },
    { key: 'completedAt' as const, label: t('common:export_headers.completed_at') },
    { key: 'result' as const, label: t('common:export_headers.result') },
    { key: 'notes' as const, label: t('common:export_headers.notes') },
  ];
}

interface RevisionExportRow {
  customerName: string;
  deviceName: string;
  street: string;
  city: string;
  dueDate: string;
  status: string;
  scheduledDate: string;
  completedAt: string;
  result: string;
  notes: string;
}

interface RevisionWithDetails {
  id: string;
  customerId: string;
  deviceId: string;
  dueDate: string;
  status: string;
  scheduledDate?: string | null;
  completedAt?: string | null;
  result?: string | null;
  notes?: string | null;
  customerName?: string;
  customerStreet?: string;
  customerCity?: string;
  deviceName?: string;
}

/**
 * Export revisions to CSV
 */
export async function exportRevisions(
  options: {
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  } = {},
  deps = { 
    listRevisions: revisionService.listRevisions,
    request: useNatsStore.getState().request,
  }
): Promise<void> {
  // Fetch revisions
  const result = await deps.listRevisions({
    fromDate: options.dateFrom,
    toDate: options.dateTo,
    status: options.status,
  });
  const revisions = result.items as RevisionWithDetails[];
  
  // Translate status via i18n
  const t = (key: string) => i18n.t(key);
  const statusLabels: Record<string, string> = {
    pending: t('common:export_headers.pending'),
    scheduled: t('common:export_headers.scheduled_date'),
    completed: t('common:export_headers.completed_at'),
    cancelled: t('common:status.cancelled'),
  };

  // Map to export format
  const rows: RevisionExportRow[] = revisions.map(r => ({
    customerName: r.customerName || '',
    deviceName: r.deviceName || '',
    street: r.customerStreet || '',
    city: r.customerCity || '',
    dueDate: r.dueDate,
    status: statusLabels[r.status] || r.status,
    scheduledDate: r.scheduledDate || '',
    completedAt: r.completedAt ? r.completedAt.slice(0, 10) : '',
    result: r.result || '',
    notes: r.notes || '',
  }));
  
  // Generate CSV
  const csv = toCSV(rows as unknown as Record<string, unknown>[], getRevisionHeaders());
  
  // Download
  const date = new Date().toISOString().slice(0, 10);
  let filename = `revize-${date}`;
  if (options.dateFrom || options.dateTo) {
    filename += `-${options.dateFrom || 'start'}-${options.dateTo || 'end'}`;
  }
  downloadCSV(csv, `${filename}.csv`);
}

// ============================================================================
// Export count helpers (for UI)
// ============================================================================

/**
 * Get count of customers for export preview
 */
export async function getCustomerCount(
  deps = { 
    listCustomers: customerService.listCustomers,
    request: useNatsStore.getState().request,
  }
): Promise<number> {
  const result = await deps.listCustomers({});
  return result.total;
}

/**
 * Get count of revisions for export preview
 */
export async function getRevisionCount(
  options: {
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  } = {},
  deps = { 
    listRevisions: revisionService.listRevisions,
    request: useNatsStore.getState().request,
  }
): Promise<number> {
  const result = await deps.listRevisions({
    fromDate: options.dateFrom,
    toDate: options.dateTo,
    status: options.status,
  });
  return result.total;
}
