/**
 * CSV Export Service
 * 
 * Provides export functionality for customers and revisions
 */

import type { Customer } from '@sazinka/shared-types';
import * as customerService from './customerService';
import * as revisionService from './revisionService';
import { useNatsStore } from '../stores/natsStore';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

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
 * Customer export headers (matching import format)
 */
const CUSTOMER_HEADERS = [
  { key: 'name' as const, label: 'Jméno' },
  { key: 'street' as const, label: 'Ulice' },
  { key: 'city' as const, label: 'Město' },
  { key: 'postalCode' as const, label: 'PSČ' },
  { key: 'email' as const, label: 'Email' },
  { key: 'phone' as const, label: 'Telefon' },
  { key: 'notes' as const, label: 'Poznámky' },
];

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
  const customers = await deps.listCustomers(TEMP_USER_ID, { request: deps.request });
  
  // Map to export format
  const rows: CustomerExportRow[] = customers.map(c => ({
    name: c.name,
    street: c.street || '',
    city: c.city || '',
    postalCode: c.postalCode || '',
    email: c.email || '',
    phone: c.phone || '',
    notes: c.notes || '',
  }));
  
  // Generate CSV
  const csv = toCSV(rows, CUSTOMER_HEADERS);
  
  // Download
  const date = new Date().toISOString().slice(0, 10);
  downloadCSV(csv, `zakaznici-${date}.csv`);
}

// ============================================================================
// Revision Export
// ============================================================================

/**
 * Revision export headers
 */
const REVISION_HEADERS = [
  { key: 'customerName' as const, label: 'Zákazník' },
  { key: 'deviceName' as const, label: 'Zařízení' },
  { key: 'street' as const, label: 'Ulice' },
  { key: 'city' as const, label: 'Město' },
  { key: 'dueDate' as const, label: 'Termín' },
  { key: 'status' as const, label: 'Stav' },
  { key: 'scheduledDate' as const, label: 'Naplánováno' },
  { key: 'completedAt' as const, label: 'Dokončeno' },
  { key: 'result' as const, label: 'Výsledek' },
  { key: 'notes' as const, label: 'Poznámky' },
];

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
  const revisions = await deps.listRevisions(TEMP_USER_ID, {
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    status: options.status,
  }, { request: deps.request }) as RevisionWithDetails[];
  
  // Translate status
  const statusLabels: Record<string, string> = {
    pending: 'Čeká',
    scheduled: 'Naplánováno',
    completed: 'Dokončeno',
    cancelled: 'Zrušeno',
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
  const csv = toCSV(rows, REVISION_HEADERS);
  
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
  const customers = await deps.listCustomers(TEMP_USER_ID, { request: deps.request });
  return customers.length;
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
  const revisions = await deps.listRevisions(TEMP_USER_ID, {
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    status: options.status,
  }, { request: deps.request });
  return revisions.length;
}
