/**
 * customerColumns — single source of truth for all customer table columns.
 *
 * SortEntry is the canonical definition from the NATS contract
 * (packages/shared-types/src/customer.ts); re-exported here for frontend convenience.
 */

import type { SortEntry } from '@shared/customer';

export type { SortEntry };

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
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export const ALL_COLUMNS: CustomerColumnDef[] = [
  { id: 'name',         labelKey: 'col_name',        category: 'identity',   sortField: 'name',          sortable: true,  core: true,  defaultVisible: true  },
  { id: 'type',         labelKey: 'col_type',         category: 'identity',   sortField: 'type',          sortable: true,  core: false, defaultVisible: false },
  { id: 'city',         labelKey: 'col_city',         category: 'location',   sortField: 'city',          sortable: true,  core: false, defaultVisible: true  },
  { id: 'street',       labelKey: 'col_street',       category: 'location',   sortField: 'street',        sortable: true,  core: false, defaultVisible: false },
  { id: 'postalCode',   labelKey: 'col_postal_code',  category: 'location',   sortField: 'postalCode',    sortable: true,  core: false, defaultVisible: false },
  { id: 'phone',        labelKey: 'col_phone',        category: 'contact',    sortField: 'phone',         sortable: true,  core: false, defaultVisible: false },
  { id: 'email',        labelKey: 'col_email',        category: 'contact',    sortField: 'email',         sortable: true,  core: false, defaultVisible: false },
  { id: 'deviceCount',  labelKey: 'col_devices',      category: 'revision',   sortField: 'deviceCount',   sortable: true,  core: false, defaultVisible: true  },
  { id: 'nextRevision', labelKey: 'col_revision',     category: 'revision',   sortField: 'nextRevision',  sortable: true,  core: false, defaultVisible: true  },
  { id: 'geocodeStatus',labelKey: 'col_geocode',      category: 'operations', sortField: 'geocodeStatus', sortable: true,  core: false, defaultVisible: true  },
  { id: 'createdAt',    labelKey: 'col_created_at',   category: 'operations', sortField: 'createdAt',     sortable: true,  core: false, defaultVisible: false },
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
