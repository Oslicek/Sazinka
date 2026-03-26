/**
 * Phase 1A (RED → GREEN) — customerColumns module tests.
 *
 * Covers catalog integrity, helper functions, and all sanitizers:
 * sanitizeSortModel, sanitizeVisibleColumns, sanitizeColumnOrder,
 * filterType property, getFilterType, isValidColumnFilter, sanitizeColumnFilters.
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
  getFilterType,
  isValidColumnFilter,
  sanitizeColumnFilters,
} from '../customerColumns';
import type { SortEntry } from '../customerColumns';

// ── Catalog integrity ─────────────────────────────────────────────────────────

describe('Phase 1A: customerColumns — catalog integrity', () => {
  it('0. ALL_COLUMNS has exactly 11 columns', () => {
    expect(ALL_COLUMNS).toHaveLength(11);
  });

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

  it('26. deviceCount column returns sortField deviceCount', () => {
    expect(getSortField('deviceCount')).toBe('deviceCount');
  });

  it('27. nextRevision column returns sortField nextRevision', () => {
    expect(getSortField('nextRevision')).toBe('nextRevision');
  });

  it('28. createdAt column returns sortField createdAt', () => {
    expect(getSortField('createdAt')).toBe('createdAt');
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

// ── filterType property ───────────────────────────────────────────────────────

describe('Phase 1B: filterType — column catalog', () => {
  it('F1. every column has a filterType property', () => {
    ALL_COLUMNS.forEach((c) => {
      expect(c).toHaveProperty('filterType');
      expect(['checklist', 'dateRange']).toContain(c.filterType);
    });
  });

  it('F2. checklist columns are exactly the 9 categorical columns', () => {
    const checklistIds = ALL_COLUMNS.filter((c) => c.filterType === 'checklist').map((c) => c.id);
    expect(checklistIds.sort()).toEqual(
      ['name', 'type', 'city', 'street', 'postalCode', 'phone', 'email', 'geocodeStatus', 'deviceCount'].sort()
    );
  });

  it('F3. dateRange columns are exactly nextRevision and createdAt', () => {
    const dateIds = ALL_COLUMNS.filter((c) => c.filterType === 'dateRange').map((c) => c.id);
    expect(dateIds.sort()).toEqual(['createdAt', 'nextRevision']);
  });

  it('F4. total filterType counts sum to 11', () => {
    const checklists = ALL_COLUMNS.filter((c) => c.filterType === 'checklist').length;
    const dateRanges = ALL_COLUMNS.filter((c) => c.filterType === 'dateRange').length;
    expect(checklists + dateRanges).toBe(11);
  });
});

// ── getFilterType ─────────────────────────────────────────────────────────────

describe('Phase 1B: getFilterType helper', () => {
  it('F5. name → checklist', () => expect(getFilterType('name')).toBe('checklist'));
  it('F6. type → checklist', () => expect(getFilterType('type')).toBe('checklist'));
  it('F7. city → checklist', () => expect(getFilterType('city')).toBe('checklist'));
  it('F8. street → checklist', () => expect(getFilterType('street')).toBe('checklist'));
  it('F9. postalCode → checklist', () => expect(getFilterType('postalCode')).toBe('checklist'));
  it('F10. phone → checklist', () => expect(getFilterType('phone')).toBe('checklist'));
  it('F11. email → checklist', () => expect(getFilterType('email')).toBe('checklist'));
  it('F12. geocodeStatus → checklist', () => expect(getFilterType('geocodeStatus')).toBe('checklist'));
  it('F13. deviceCount → checklist', () => expect(getFilterType('deviceCount')).toBe('checklist'));
  it('F14. nextRevision → dateRange', () => expect(getFilterType('nextRevision')).toBe('dateRange'));
  it('F15. createdAt → dateRange', () => expect(getFilterType('createdAt')).toBe('dateRange'));
  it('F16. unknown column → undefined', () => expect(getFilterType('unknown_xyz')).toBeUndefined());
});

// ── isValidColumnFilter ───────────────────────────────────────────────────────

describe('Phase 1B: isValidColumnFilter validator', () => {
  it('F17. valid checklist filter → true', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'city', values: ['Prague'] })).toBe(true);
  });

  it('F18. checklist with multiple values → true', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'type', values: ['company', 'person'] })).toBe(true);
  });

  it('F19. valid dateRange filter with both bounds → true', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt', from: '2024-01-01', to: '2024-12-31' })).toBe(true);
  });

  it('F20. valid dateRange filter with only from → true', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'nextRevision', from: '2024-06-01' })).toBe(true);
  });

  it('F21. valid dateRange filter with only to → true', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt', to: '2024-12-31' })).toBe(true);
  });

  it('F22. null → false', () => expect(isValidColumnFilter(null)).toBe(false));
  it('F23. undefined → false', () => expect(isValidColumnFilter(undefined)).toBe(false));
  it('F24. string → false', () => expect(isValidColumnFilter('city')).toBe(false));
  it('F25. number → false', () => expect(isValidColumnFilter(42)).toBe(false));

  it('F26. missing type → false', () => {
    expect(isValidColumnFilter({ column: 'city', values: ['Prague'] })).toBe(false);
  });

  it('F27. missing column → false', () => {
    expect(isValidColumnFilter({ type: 'checklist', values: ['Prague'] })).toBe(false);
  });

  it('F28. unknown type → false', () => {
    expect(isValidColumnFilter({ type: 'range', column: 'city', values: ['Prague'] })).toBe(false);
  });

  it('F29. unknown column ID → false', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'nonexistent_col', values: ['x'] })).toBe(false);
  });

  it('F30. checklist on a dateRange column → false', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'createdAt', values: ['2024-01-01'] })).toBe(false);
  });

  it('F31. dateRange on a checklist column → false', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'city', from: '2024-01-01' })).toBe(false);
  });

  it('F32. checklist with non-array values → false', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'city', values: 'Prague' })).toBe(false);
  });

  it('F33. checklist with empty values array → false', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'city', values: [] })).toBe(false);
  });

  it('F33b. checklist with non-string values → false', () => {
    expect(isValidColumnFilter({ type: 'checklist', column: 'city', values: [42, true] })).toBe(false);
    expect(isValidColumnFilter({ type: 'checklist', column: 'city', values: ['ok', 123] })).toBe(false);
  });

  it('F34. dateRange with no bounds (both missing) → false', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt' })).toBe(false);
  });

  it('F35. dateRange with non-string from → false', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt', from: 123 })).toBe(false);
  });

  it('F36. dateRange with invalid date format → false', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt', from: 'not-a-date' })).toBe(false);
  });

  it('F37. dateRange from > to → false', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt', from: '2024-12-31', to: '2024-01-01' })).toBe(false);
  });

  it('F38. dateRange same day from = to → true (inclusive single day)', () => {
    expect(isValidColumnFilter({ type: 'dateRange', column: 'createdAt', from: '2024-06-15', to: '2024-06-15' })).toBe(true);
  });
});

// ── sanitizeColumnFilters ─────────────────────────────────────────────────────

describe('Phase 1B: sanitizeColumnFilters sanitizer', () => {
  it('F39. null → empty array', () => expect(sanitizeColumnFilters(null)).toEqual([]));
  it('F40. undefined → empty array', () => expect(sanitizeColumnFilters(undefined)).toEqual([]));
  it('F41. empty array → empty array', () => expect(sanitizeColumnFilters([])).toEqual([]));
  it('F42. non-array → empty array', () => expect(sanitizeColumnFilters('invalid')).toEqual([]));

  it('F43. valid checklist filter → preserved', () => {
    const filter = { type: 'checklist', column: 'city', values: ['Prague'] };
    expect(sanitizeColumnFilters([filter])).toEqual([filter]);
  });

  it('F44. valid dateRange filter → preserved', () => {
    const filter = { type: 'dateRange', column: 'createdAt', from: '2024-01-01' };
    expect(sanitizeColumnFilters([filter])).toEqual([filter]);
  });

  it('F45. invalid filter in array → stripped', () => {
    const valid = { type: 'checklist', column: 'city', values: ['Prague'] };
    const invalid = { type: 'checklist', column: 'nonexistent', values: ['x'] };
    expect(sanitizeColumnFilters([valid, invalid])).toEqual([valid]);
  });

  it('F46. all invalid → empty array', () => {
    expect(sanitizeColumnFilters([{ type: 'unknown', column: 'city' }])).toEqual([]);
  });

  it('F47. duplicate column entries → first wins, second stripped', () => {
    const first = { type: 'checklist', column: 'city', values: ['Prague'] };
    const second = { type: 'checklist', column: 'city', values: ['Brno'] };
    expect(sanitizeColumnFilters([first, second])).toEqual([first]);
  });

  it('F48. duplicate column entries (different filter types) → first wins', () => {
    // Can't actually have same column with different types since filterType is fixed per column,
    // but still test that duplicate column key is handled
    const first = { type: 'checklist', column: 'name', values: ['Alice'] };
    const second = { type: 'checklist', column: 'name', values: ['Bob'] };
    const result = sanitizeColumnFilters([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(first);
  });

  it('F49. multiple valid different columns → all preserved', () => {
    const filters = [
      { type: 'checklist', column: 'city', values: ['Prague'] },
      { type: 'checklist', column: 'type', values: ['company'] },
      { type: 'dateRange', column: 'createdAt', from: '2024-01-01' },
    ];
    expect(sanitizeColumnFilters(filters)).toEqual(filters);
  });

  it('F50. mixed valid + invalid with duplicates → valid non-duplicate entries only', () => {
    const filters = [
      { type: 'checklist', column: 'city', values: ['Prague'] },       // valid
      { type: 'checklist', column: 'nonexistent', values: ['x'] },    // invalid column
      { type: 'checklist', column: 'city', values: ['Brno'] },         // duplicate
    ];
    const result = sanitizeColumnFilters(filters);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'checklist', column: 'city', values: ['Prague'] });
  });
});
