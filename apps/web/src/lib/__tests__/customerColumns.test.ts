/**
 * Phase 1A (RED → GREEN) — customerColumns module tests.
 *
 * Covers catalog integrity, helper functions, and all sanitizers:
 * sanitizeSortModel, sanitizeVisibleColumns, sanitizeColumnOrder.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_COLUMNS,
  COLUMN_CATEGORIES,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_SORT_MODEL,
  DEFAULT_COLUMN_ORDER,
  CORE_COLUMN_IDS,
  MAX_VISIBLE_COLUMNS,
  getColumnDef,
  getSortField,
  isValidSortModel,
  sanitizeSortModel,
  sanitizeVisibleColumns,
  sanitizeColumnOrder,
} from '../customerColumns';
import type { SortEntry } from '../customerColumns';

// ── Catalog integrity ─────────────────────────────────────────────────────────

describe('Phase 1A: customerColumns — catalog integrity', () => {
  it('1. ALL_COLUMNS has no duplicate IDs', () => {
    const ids = ALL_COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('2. every DEFAULT_VISIBLE_COLUMNS entry is a valid column ID', () => {
    const ids = new Set(ALL_COLUMNS.map((c) => c.id));
    DEFAULT_VISIBLE_COLUMNS.forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it('3. every CORE_COLUMN_IDS entry is a valid column ID', () => {
    const ids = new Set(ALL_COLUMNS.map((c) => c.id));
    CORE_COLUMN_IDS.forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it('4. every DEFAULT_COLUMN_ORDER entry is a valid column ID', () => {
    const ids = new Set(ALL_COLUMNS.map((c) => c.id));
    DEFAULT_COLUMN_ORDER.forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it('5. DEFAULT_COLUMN_ORDER contains all column IDs', () => {
    const allIds = new Set(ALL_COLUMNS.map((c) => c.id));
    const orderIds = new Set(DEFAULT_COLUMN_ORDER);
    allIds.forEach((id) => expect(orderIds.has(id)).toBe(true));
    expect(DEFAULT_COLUMN_ORDER.length).toBe(ALL_COLUMNS.length);
  });

  it('6. DEFAULT_VISIBLE_COLUMNS includes all CORE_COLUMN_IDS', () => {
    const visible = new Set(DEFAULT_VISIBLE_COLUMNS);
    CORE_COLUMN_IDS.forEach((id) => expect(visible.has(id)).toBe(true));
  });

  it('7. DEFAULT_VISIBLE_COLUMNS.length <= MAX_VISIBLE_COLUMNS', () => {
    expect(DEFAULT_VISIBLE_COLUMNS.length).toBeLessThanOrEqual(MAX_VISIBLE_COLUMNS);
  });

  it('8. MAX_VISIBLE_COLUMNS >= CORE_COLUMN_IDS.length', () => {
    expect(MAX_VISIBLE_COLUMNS).toBeGreaterThanOrEqual(CORE_COLUMN_IDS.length);
  });

  it('9. at least one column per ColumnCategory', () => {
    const usedCategories = new Set(ALL_COLUMNS.map((c) => c.category));
    COLUMN_CATEGORIES.forEach((cat) => expect(usedCategories.has(cat)).toBe(true));
  });

  it('10. every sortable column has a non-empty sortField', () => {
    ALL_COLUMNS.filter((c) => c.sortable).forEach((c) => {
      expect(c.sortField).toBeTruthy();
    });
  });

  it('11. every column is sortable (all 11 columns support sorting)', () => {
    expect(ALL_COLUMNS.every((c) => c.sortable)).toBe(true);
  });

  it('11b. every column has a non-empty sortField', () => {
    ALL_COLUMNS.forEach((c) => {
      expect(c.sortField).toBeTruthy();
    });
  });

  it('12. every sortField maps to a known whitelist entry', () => {
    const validSortFields = new Set([
      'name', 'type', 'city', 'street', 'postalCode',
      'phone', 'email', 'deviceCount', 'nextRevision', 'geocodeStatus', 'createdAt',
    ]);
    ALL_COLUMNS.forEach((c) => {
      expect(validSortFields.has(c.sortField!)).toBe(true);
    });
  });

  it('13. DEFAULT_SORT_MODEL is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_SORT_MODEL)).toBe(true);
    expect(DEFAULT_SORT_MODEL.length).toBeGreaterThan(0);
  });

  it('14. DEFAULT_SORT_MODEL[0].column is a sortable column ID', () => {
    const sortableIds = new Set(ALL_COLUMNS.filter((c) => c.sortable).map((c) => c.id));
    expect(sortableIds.has(DEFAULT_SORT_MODEL[0].column)).toBe(true);
  });

  it('15. DEFAULT_SORT_MODEL[0].direction is asc or desc', () => {
    expect(['asc', 'desc']).toContain(DEFAULT_SORT_MODEL[0].direction);
  });
});

// ── getColumnDef ──────────────────────────────────────────────────────────────

describe('Phase 1A: getColumnDef helper', () => {
  it('16. known ID returns correct CustomerColumnDef', () => {
    const def = getColumnDef('name');
    expect(def).toBeDefined();
    expect(def!.id).toBe('name');
    expect(def!.core).toBe(true);
  });

  it('17. unknown ID returns undefined', () => {
    expect(getColumnDef('nonexistent_column_xyz')).toBeUndefined();
  });
});

// ── getSortField ──────────────────────────────────────────────────────────────

describe('Phase 1A: getSortField helper', () => {
  it('18. sortable column ID returns corresponding sortField', () => {
    expect(getSortField('name')).toBe('name');
    expect(getSortField('city')).toBe('city');
  });

  it('19. email column returns sortField email', () => {
    expect(getSortField('email')).toBe('email');
  });

  it('20. unknown column ID returns undefined', () => {
    expect(getSortField('completely_unknown')).toBeUndefined();
  });

  it('21. type column returns sortField type', () => {
    expect(getSortField('type')).toBe('type');
  });

  it('22. street column returns sortField street', () => {
    expect(getSortField('street')).toBe('street');
  });

  it('23. postalCode column returns sortField postalCode', () => {
    expect(getSortField('postalCode')).toBe('postalCode');
  });

  it('24. phone column returns sortField phone', () => {
    expect(getSortField('phone')).toBe('phone');
  });

  it('25. geocodeStatus column returns sortField geocodeStatus', () => {
    expect(getSortField('geocodeStatus')).toBe('geocodeStatus');
  });
});

// ── isValidSortModel ──────────────────────────────────────────────────────────

describe('Phase 1A: isValidSortModel validator', () => {
  it('21. valid single-entry array → true', () => {
    expect(isValidSortModel([{ column: 'name', direction: 'asc' }])).toBe(true);
  });

  it('22. valid multi-entry array → true', () => {
    expect(
      isValidSortModel([
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'desc' },
      ])
    ).toBe(true);
  });

  it('23. empty array → false', () => {
    expect(isValidSortModel([])).toBe(false);
  });

  it('24. null → false', () => {
    expect(isValidSortModel(null)).toBe(false);
  });

  it('25. undefined → false', () => {
    expect(isValidSortModel(undefined)).toBe(false);
  });

  it('26. string → false', () => {
    expect(isValidSortModel('name')).toBe(false);
  });

  it('27. number → false', () => {
    expect(isValidSortModel(42)).toBe(false);
  });

  it('28. array of strings → false', () => {
    expect(isValidSortModel(['name', 'city'])).toBe(false);
  });

  it('29. array with missing column → false', () => {
    expect(isValidSortModel([{ direction: 'asc' }])).toBe(false);
  });

  it('30. array with missing direction → false', () => {
    expect(isValidSortModel([{ column: 'name' }])).toBe(false);
  });

  it('31. array with direction: invalid → false', () => {
    expect(isValidSortModel([{ column: 'name', direction: 'invalid' }])).toBe(false);
  });

  it('32. array with column referencing non-existent column → false', () => {
    expect(isValidSortModel([{ column: 'nonexistent_col', direction: 'asc' }])).toBe(false);
  });

  it('33. array with column referencing non-existent column → false', () => {
    expect(isValidSortModel([{ column: 'nonexistent_col', direction: 'asc' }])).toBe(false);
  });

  it('33b. email column is now sortable → isValidSortModel returns true', () => {
    expect(isValidSortModel([{ column: 'email', direction: 'asc' }])).toBe(true);
  });

  it('33c. type column is now sortable → isValidSortModel returns true', () => {
    expect(isValidSortModel([{ column: 'type', direction: 'asc' }])).toBe(true);
  });

  it('33d. street column is now sortable → isValidSortModel returns true', () => {
    expect(isValidSortModel([{ column: 'street', direction: 'desc' }])).toBe(true);
  });

  it('33e. postalCode column is now sortable → isValidSortModel returns true', () => {
    expect(isValidSortModel([{ column: 'postalCode', direction: 'asc' }])).toBe(true);
  });

  it('33f. phone column is now sortable → isValidSortModel returns true', () => {
    expect(isValidSortModel([{ column: 'phone', direction: 'asc' }])).toBe(true);
  });

  it('33g. geocodeStatus column is now sortable → isValidSortModel returns true', () => {
    expect(isValidSortModel([{ column: 'geocodeStatus', direction: 'asc' }])).toBe(true);
  });

  it('33h. all 11 columns in one model → isValidSortModel returns true', () => {
    const allColumns = [
      { column: 'name', direction: 'asc' as const },
      { column: 'type', direction: 'asc' as const },
      { column: 'city', direction: 'asc' as const },
      { column: 'street', direction: 'asc' as const },
      { column: 'postalCode', direction: 'asc' as const },
      { column: 'phone', direction: 'asc' as const },
      { column: 'email', direction: 'asc' as const },
      { column: 'deviceCount', direction: 'asc' as const },
      { column: 'nextRevision', direction: 'asc' as const },
      { column: 'geocodeStatus', direction: 'asc' as const },
      { column: 'createdAt', direction: 'asc' as const },
    ];
    expect(isValidSortModel(allColumns)).toBe(true);
  });

  it('34. array with duplicate columns → false', () => {
    expect(
      isValidSortModel([
        { column: 'name', direction: 'asc' },
        { column: 'name', direction: 'desc' },
      ])
    ).toBe(false);
  });
});

// ── sanitizeSortModel ─────────────────────────────────────────────────────────

describe('Phase 1A: sanitizeSortModel sanitizer', () => {
  const DEFAULT: SortEntry[] = [{ column: 'name', direction: 'asc' }];

  it('35. valid model → returns same model', () => {
    const model: SortEntry[] = [{ column: 'name', direction: 'asc' }];
    expect(sanitizeSortModel(model)).toEqual(model);
  });

  it('36. null → returns DEFAULT_SORT_MODEL', () => {
    expect(sanitizeSortModel(null)).toEqual(DEFAULT);
  });

  it('37. undefined → returns DEFAULT_SORT_MODEL', () => {
    expect(sanitizeSortModel(undefined)).toEqual(DEFAULT);
  });

  it('38. empty array → returns DEFAULT_SORT_MODEL (canonical non-empty)', () => {
    expect(sanitizeSortModel([])).toEqual(DEFAULT);
  });

  it('39. non-array (string) → returns DEFAULT_SORT_MODEL', () => {
    expect(sanitizeSortModel('name')).toEqual(DEFAULT);
  });

  it('40. array with one invalid entry among valid ones → strips invalid, keeps valid', () => {
    const model = [
      { column: 'name', direction: 'asc' },
      { column: 'nonexistent', direction: 'asc' },
    ];
    const result = sanitizeSortModel(model);
    expect(result).toEqual([{ column: 'name', direction: 'asc' }]);
  });

  it('41. array with all invalid entries → returns DEFAULT_SORT_MODEL', () => {
    expect(sanitizeSortModel([{ column: 'bad', direction: 'asc' }])).toEqual(DEFAULT);
  });

  it('41b. email in sort model → preserved as valid entry', () => {
    const model = [{ column: 'email', direction: 'asc' as const }];
    expect(sanitizeSortModel(model)).toEqual(model);
  });

  it('41c. geocodeStatus in sort model → preserved as valid entry', () => {
    const model = [{ column: 'geocodeStatus', direction: 'desc' as const }];
    expect(sanitizeSortModel(model)).toEqual(model);
  });

  it('42. array with duplicate column → keeps first occurrence, strips duplicate', () => {
    const model = [
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'desc' },
      { column: 'name', direction: 'desc' },
    ];
    const result = sanitizeSortModel(model);
    expect(result).toEqual([
      { column: 'name', direction: 'asc' },
      { column: 'city', direction: 'desc' },
    ]);
  });
});

// ── sanitizeVisibleColumns ────────────────────────────────────────────────────

describe('Phase 1A: sanitizeVisibleColumns sanitizer', () => {
  it('43. valid column ID array → returns same array', () => {
    const cols = ['name', 'city'];
    expect(sanitizeVisibleColumns(cols)).toEqual(cols);
  });

  it('44. null → returns DEFAULT_VISIBLE_COLUMNS', () => {
    expect(sanitizeVisibleColumns(null)).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('45. undefined → returns DEFAULT_VISIBLE_COLUMNS', () => {
    expect(sanitizeVisibleColumns(undefined)).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('46. empty array → returns DEFAULT_VISIBLE_COLUMNS (never empty table)', () => {
    expect(sanitizeVisibleColumns([])).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('47. array with unknown IDs → strips unknown, keeps valid', () => {
    const result = sanitizeVisibleColumns(['name', 'unknown_col']);
    expect(result).toContain('name');
    expect(result).not.toContain('unknown_col');
  });

  it('48. array with all unknown IDs → returns DEFAULT_VISIBLE_COLUMNS', () => {
    expect(sanitizeVisibleColumns(['bad1', 'bad2'])).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('49. non-array value → returns DEFAULT_VISIBLE_COLUMNS', () => {
    expect(sanitizeVisibleColumns('name')).toEqual(DEFAULT_VISIBLE_COLUMNS);
    expect(sanitizeVisibleColumns(42)).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('50. array with duplicates → deduplicates, keeps first occurrence', () => {
    const result = sanitizeVisibleColumns(['name', 'city', 'name']);
    const nameCount = result.filter((id) => id === 'name').length;
    expect(nameCount).toBe(1);
  });

  it('51. array missing a core column → prepends core column(s)', () => {
    const result = sanitizeVisibleColumns(['city', 'deviceCount']);
    CORE_COLUMN_IDS.forEach((id) => expect(result).toContain(id));
  });

  it('52. array exceeding MAX_VISIBLE_COLUMNS → truncated to limit (core preserved)', () => {
    const allIds = ALL_COLUMNS.map((c) => c.id);
    const result = sanitizeVisibleColumns(allIds);
    expect(result.length).toBeLessThanOrEqual(MAX_VISIBLE_COLUMNS);
    CORE_COLUMN_IDS.forEach((id) => expect(result).toContain(id));
  });
});

// ── sanitizeColumnOrder ───────────────────────────────────────────────────────

describe('Phase 1A: sanitizeColumnOrder sanitizer', () => {
  it('53. valid full column order array → returns same array', () => {
    expect(sanitizeColumnOrder(DEFAULT_COLUMN_ORDER)).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('54. null → returns DEFAULT_COLUMN_ORDER', () => {
    expect(sanitizeColumnOrder(null)).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('55. undefined → returns DEFAULT_COLUMN_ORDER', () => {
    expect(sanitizeColumnOrder(undefined)).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('56. empty array → returns DEFAULT_COLUMN_ORDER', () => {
    expect(sanitizeColumnOrder([])).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('57. non-array value → returns DEFAULT_COLUMN_ORDER', () => {
    expect(sanitizeColumnOrder('name')).toEqual(DEFAULT_COLUMN_ORDER);
    expect(sanitizeColumnOrder(42)).toEqual(DEFAULT_COLUMN_ORDER);
    expect(sanitizeColumnOrder({})).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('58. array with unknown IDs → strips unknown, keeps valid; if none remain, returns default', () => {
    const result = sanitizeColumnOrder(['name', 'unknown_col']);
    expect(result).toContain('name');
    expect(result).not.toContain('unknown_col');
    // All columns must be represented (missing ones appended)
    ALL_COLUMNS.forEach((c) => expect(result).toContain(c.id));
  });

  it('59. array with duplicate IDs → deduplicates, keeps first occurrence', () => {
    const withDups = ['name', 'city', 'name', 'email'];
    const result = sanitizeColumnOrder(withDups);
    const nameCount = result.filter((id) => id === 'name').length;
    expect(nameCount).toBe(1);
  });

  it('60. array missing some known column IDs → appends missing IDs at end', () => {
    const partial = ['name', 'city'];
    const result = sanitizeColumnOrder(partial);
    ALL_COLUMNS.forEach((c) => expect(result).toContain(c.id));
    expect(result[0]).toBe('name');
    expect(result[1]).toBe('city');
  });

  it('61. array with all unknown IDs → returns DEFAULT_COLUMN_ORDER', () => {
    expect(sanitizeColumnOrder(['bad1', 'bad2'])).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('62. valid reordering of all columns → returns as-is (preserves drag-reorder)', () => {
    const reordered = [...DEFAULT_COLUMN_ORDER].reverse();
    expect(sanitizeColumnOrder(reordered)).toEqual(reordered);
  });
});
