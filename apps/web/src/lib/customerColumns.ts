/**
 * customerColumns — single source of truth for all customer table columns.
 *
 * SortEntry is the canonical definition from the NATS contract
 * (packages/shared-types/src/customer.ts); re-exported here for frontend convenience.
 */

import type { SortEntry, ColumnFilter } from '@shared/customer';

export type { SortEntry };
export type { ColumnFilter };

// ── Types ─────────────────────────────────────────────────────────────────────

export type ColumnCategory = 'identity' | 'contact' | 'location' | 'revision' | 'operations';

export interface CustomerColumnDef {
  id: string;
  labelKey: string;
  category: ColumnCategory;
  sortField?: string;
  sortable: boolean;
  core: boolean;
  defaultVisible: boolean;
  defaultWidth?: number;
  /** Filter type for Excel-style column filters */
  filterType: 'checklist' | 'dateRange';
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export const ALL_COLUMNS: CustomerColumnDef[] = [
  { id: 'name',         labelKey: 'col_name',        category: 'identity',   sortField: 'name',          sortable: true,  core: true,  defaultVisible: true,  filterType: 'checklist' },
  { id: 'type',         labelKey: 'col_type',         category: 'identity',   sortField: 'type',          sortable: true,  core: false, defaultVisible: false, filterType: 'checklist' },
  { id: 'city',         labelKey: 'col_city',         category: 'location',   sortField: 'city',          sortable: true,  core: false, defaultVisible: true,  filterType: 'checklist' },
  { id: 'street',       labelKey: 'col_street',       category: 'location',   sortField: 'street',        sortable: true,  core: false, defaultVisible: false, filterType: 'checklist' },
  { id: 'postalCode',   labelKey: 'col_postal_code',  category: 'location',   sortField: 'postalCode',    sortable: true,  core: false, defaultVisible: false, filterType: 'checklist' },
  { id: 'phone',        labelKey: 'col_phone',        category: 'contact',    sortField: 'phone',         sortable: true,  core: false, defaultVisible: false, filterType: 'checklist' },
  { id: 'email',        labelKey: 'col_email',        category: 'contact',    sortField: 'email',         sortable: true,  core: false, defaultVisible: false, filterType: 'checklist' },
  { id: 'deviceCount',  labelKey: 'col_devices',      category: 'revision',   sortField: 'deviceCount',   sortable: true,  core: false, defaultVisible: true,  filterType: 'checklist' },
  { id: 'nextRevision', labelKey: 'col_revision',     category: 'revision',   sortField: 'nextRevision',  sortable: true,  core: false, defaultVisible: true,  filterType: 'dateRange' },
  { id: 'geocodeStatus',labelKey: 'col_geocode',      category: 'operations', sortField: 'geocodeStatus', sortable: true,  core: false, defaultVisible: true,  filterType: 'checklist' },
  { id: 'createdAt',    labelKey: 'col_created_at',   category: 'operations', sortField: 'createdAt',     sortable: true,  core: false, defaultVisible: false, filterType: 'dateRange' },
];

export const COLUMN_CATEGORIES: ColumnCategory[] = [
  'identity',
  'contact',
  'location',
  'revision',
  'operations',
];

export const MAX_VISIBLE_COLUMNS = 10;

export const CORE_COLUMN_IDS: string[] = ALL_COLUMNS.filter((c) => c.core).map((c) => c.id);

export const DEFAULT_VISIBLE_COLUMNS: string[] = ALL_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.id);

export const DEFAULT_COLUMN_ORDER: string[] = ALL_COLUMNS.map((c) => c.id);

export const DEFAULT_SORT_MODEL: SortEntry[] = [{ column: 'name', direction: 'asc' }];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getColumnDef(id: string): CustomerColumnDef | undefined {
  return ALL_COLUMNS.find((c) => c.id === id);
}

export function getSortField(columnId: string): string | undefined {
  return ALL_COLUMNS.find((c) => c.id === columnId)?.sortField;
}

export function isValidSortModel(model: unknown): model is SortEntry[] {
  if (!Array.isArray(model) || model.length === 0) return false;

  const seen = new Set<string>();
  for (const entry of model) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>).column !== 'string' ||
      typeof (entry as Record<string, unknown>).direction !== 'string'
    ) {
      return false;
    }
    const { column, direction } = entry as { column: string; direction: string };
    if (direction !== 'asc' && direction !== 'desc') return false;
    const def = getColumnDef(column);
    if (!def || !def.sortable) return false;
    if (seen.has(column)) return false;
    seen.add(column);
  }
  return true;
}

export function sanitizeSortModel(model: unknown): SortEntry[] {
  if (!Array.isArray(model)) return [...DEFAULT_SORT_MODEL];

  const seen = new Set<string>();
  const valid: SortEntry[] = [];

  for (const entry of model) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>).column !== 'string' ||
      typeof (entry as Record<string, unknown>).direction !== 'string'
    ) {
      continue;
    }
    const { column, direction } = entry as { column: string; direction: string };
    if (direction !== 'asc' && direction !== 'desc') continue;
    const def = getColumnDef(column);
    if (!def || !def.sortable) continue;
    if (seen.has(column)) continue;
    seen.add(column);
    valid.push({ column, direction: direction as 'asc' | 'desc' });
  }

  return valid.length > 0 ? valid : [...DEFAULT_SORT_MODEL];
}

export function sanitizeVisibleColumns(cols: unknown): string[] {
  if (!Array.isArray(cols)) return [...DEFAULT_VISIBLE_COLUMNS];

  const validIds = new Set(ALL_COLUMNS.map((c) => c.id));
  const seen = new Set<string>();
  const valid: string[] = [];

  for (const id of cols) {
    if (typeof id !== 'string') continue;
    if (!validIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push(id);
  }

  if (valid.length === 0) return [...DEFAULT_VISIBLE_COLUMNS];

  // Ensure all core columns are present (prepend missing ones)
  const result = [...valid];
  for (const coreId of CORE_COLUMN_IDS) {
    if (!seen.has(coreId)) {
      result.unshift(coreId);
    }
  }

  // Enforce max visible columns (preserve core columns)
  if (result.length > MAX_VISIBLE_COLUMNS) {
    const coreSet = new Set(CORE_COLUMN_IDS);
    const cores = result.filter((id) => coreSet.has(id));
    const extras = result.filter((id) => !coreSet.has(id));
    const remainingSlots = MAX_VISIBLE_COLUMNS - cores.length;
    return [...cores, ...extras.slice(0, remainingSlots)];
  }

  return result;
}

/** Get the filter type for a column ID, or undefined if unknown. */
export function getFilterType(columnId: string): 'checklist' | 'dateRange' | undefined {
  return ALL_COLUMNS.find((c) => c.id === columnId)?.filterType;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!DATE_REGEX.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

/**
 * Validate a single ColumnFilter.
 * Rules:
 * - type must be 'checklist' or 'dateRange'
 * - column must be a known column ID
 * - type must match the column's filterType
 * - checklist: values must be a non-empty string array
 * - dateRange: at least one of from/to must be a valid YYYY-MM-DD date; from <= to
 */
export function isValidColumnFilter(filter: unknown): filter is ColumnFilter {
  if (typeof filter !== 'object' || filter === null) return false;
  const f = filter as Record<string, unknown>;
  if (typeof f.type !== 'string') return false;
  if (typeof f.column !== 'string') return false;

  const expectedFilterType = getFilterType(f.column);
  if (!expectedFilterType) return false;
  if (f.type !== expectedFilterType) return false;

  if (f.type === 'checklist') {
    if (!Array.isArray(f.values) || f.values.length === 0) return false;
    return true;
  }

  if (f.type === 'dateRange') {
    const hasFrom = f.from !== undefined;
    const hasTo = f.to !== undefined;
    if (!hasFrom && !hasTo) return false;
    if (hasFrom && !isValidDateString(f.from)) return false;
    if (hasTo && !isValidDateString(f.to)) return false;
    if (hasFrom && hasTo && typeof f.from === 'string' && typeof f.to === 'string') {
      if (f.from > f.to) return false;
    }
    return true;
  }

  return false;
}

/**
 * Sanitize an array of ColumnFilters.
 * - Drops invalid entries
 * - Duplicate column IDs: first wins (later ones are dropped)
 */
export function sanitizeColumnFilters(filters: unknown): ColumnFilter[] {
  if (!Array.isArray(filters)) return [];
  const seen = new Set<string>();
  const result: ColumnFilter[] = [];
  for (const f of filters) {
    if (!isValidColumnFilter(f)) continue;
    if (seen.has(f.column)) continue;
    seen.add(f.column);
    result.push(f);
  }
  return result;
}

export function sanitizeColumnOrder(order: unknown): string[] {
  if (!Array.isArray(order)) return [...DEFAULT_COLUMN_ORDER];

  const validIds = new Set(ALL_COLUMNS.map((c) => c.id));
  const seen = new Set<string>();
  const valid: string[] = [];

  for (const id of order) {
    if (typeof id !== 'string') continue;
    if (!validIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push(id);
  }

  if (valid.length === 0) return [...DEFAULT_COLUMN_ORDER];

  // Append any missing known column IDs at the end
  for (const col of ALL_COLUMNS) {
    if (!seen.has(col.id)) {
      valid.push(col.id);
    }
  }

  return valid;
}
