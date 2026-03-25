import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_COLUMNS, DEFAULT_SORT_MODEL } from '@/lib/customerColumns';
import type { SortEntry } from '@/lib/customerColumns';
import styles from './MobileFilterSheet.module.css';

type GeocodeStatus = 'success' | 'failed' | 'pending';

export interface MobileFilterSheetProps {
  isMobile: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  geocodeFilter: GeocodeStatus | '';
  onGeocodeFilterChange: (v: GeocodeStatus | '') => void;
  revisionFilter: '' | 'overdue' | 'week' | 'month';
  onRevisionFilterChange: (v: '' | 'overdue' | 'week' | 'month') => void;
  typeFilter: 'company' | 'person' | '';
  onTypeFilterChange: (v: 'company' | 'person' | '') => void;
  sortModel: SortEntry[];
  onSortModelChange: (m: SortEntry[]) => void;
  visibleColumns: string[];
  columnOrder: string[];
  onVisibleColumnsChange: (cols: string[]) => void;
  onColumnOrderChange: (order: string[]) => void;
  onResetColumns: () => void;
}

const REVISION_CHIPS = [
  { value: '' as const, labelKey: 'filter_revision_all' },
  { value: 'overdue' as const, labelKey: 'filter_revision_overdue' },
  { value: 'week' as const, labelKey: 'filter_revision_week' },
  { value: 'month' as const, labelKey: 'filter_revision_month' },
];

const SORTABLE_COLUMNS = ALL_COLUMNS.filter((c) => c.sortable);

export function MobileFilterSheet({
  isMobile,
  search,
  onSearchChange,
  geocodeFilter,
  onGeocodeFilterChange,
  revisionFilter,
  onRevisionFilterChange,
  typeFilter,
  onTypeFilterChange,
  sortModel,
  onSortModelChange,
  visibleColumns,
  columnOrder,
  onVisibleColumnsChange,
  onColumnOrderChange,
  onResetColumns,
}: MobileFilterSheetProps) {
  const { t } = useTranslation('customers');
  const [isOpen, setIsOpen] = useState(false);

  if (!isMobile) return null;

  const primaryEntry = sortModel[0] ?? DEFAULT_SORT_MODEL[0];
  const secondaryEntry = sortModel[1] ?? null;

  function handleRevisionChip(value: '' | 'overdue' | 'week' | 'month') {
    onRevisionFilterChange(revisionFilter === value ? '' : value);
  }

  function handlePrimaryColumn(colId: string) {
    const newModel: SortEntry[] = [{ column: colId, direction: primaryEntry.direction }];
    if (secondaryEntry) newModel.push(secondaryEntry);
    onSortModelChange(newModel);
  }

  function handlePrimaryDirection(dir: 'asc' | 'desc') {
    const newModel: SortEntry[] = [{ column: primaryEntry.column, direction: dir }];
    if (secondaryEntry) newModel.push(secondaryEntry);
    onSortModelChange(newModel);
  }

  function handleSecondaryColumn(colId: string) {
    if (!colId) {
      onSortModelChange([primaryEntry]);
    } else {
      onSortModelChange([primaryEntry, { column: colId, direction: 'asc' }]);
    }
  }

  function handleClearSort() {
    onSortModelChange(DEFAULT_SORT_MODEL);
  }

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        data-testid="mobile-filter-trigger"
        className={styles.trigger}
        onClick={() => setIsOpen(true)}
      >
        {t('filter_advanced')}
      </button>

      {/* Sheet */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            data-testid="sheet-backdrop"
            className={styles.backdrop}
            onClick={() => setIsOpen(false)}
          />

          {/* Sheet content */}
          <div data-testid="mobile-filter-sheet" className={styles.sheet}>
            {/* Drag handle */}
            <div data-testid="sheet-drag-handle" className={styles.dragHandle} />

            <div className={styles.sheetContent}>
              {/* Search */}
              <input
                type="text"
                className={styles.search}
                placeholder={t('search_placeholder')}
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />

              {/* Revision chips */}
              <div className={styles.chipGroup}>
                {REVISION_CHIPS.map(({ value, labelKey }) => (
                  <button
                    key={labelKey}
                    type="button"
                    className={`${styles.chip} ${revisionFilter === value ? styles.chipActive : ''}`}
                    aria-pressed={revisionFilter === value}
                    onClick={() => handleRevisionChip(value)}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>

              {/* Geocode filter */}
              <select
                data-testid="sheet-geocode-filter"
                className={styles.select}
                value={geocodeFilter}
                onChange={(e) => onGeocodeFilterChange(e.target.value as GeocodeStatus | '')}
              >
                <option value="">{t('filter_address_all')}</option>
                <option value="success">{t('filter_address_success')}</option>
                <option value="failed">{t('filter_address_failed')}</option>
                <option value="pending">{t('filter_address_pending')}</option>
              </select>

              {/* Type filter */}
              <select
                data-testid="sheet-type-filter"
                className={styles.select}
                value={typeFilter}
                onChange={(e) => onTypeFilterChange(e.target.value as 'company' | 'person' | '')}
              >
                <option value="">{t('filter_type_all')}</option>
                <option value="company">{t('filter_type_company')}</option>
                <option value="person">{t('filter_type_person')}</option>
              </select>

              {/* Sort section */}
              <div className={styles.sortSection}>
                {/* Primary sort */}
                <div className={styles.sortRow}>
                  <select
                    data-testid="sheet-sort-primary"
                    className={styles.select}
                    value={primaryEntry.column}
                    onChange={(e) => handlePrimaryColumn(e.target.value)}
                  >
                    {SORTABLE_COLUMNS.map((col) => (
                      <option key={col.id} value={col.id}>{t(col.labelKey)}</option>
                    ))}
                  </select>
                  <select
                    data-testid="sheet-sort-primary-dir"
                    className={styles.selectSmall}
                    value={primaryEntry.direction}
                    onChange={(e) => handlePrimaryDirection(e.target.value as 'asc' | 'desc')}
                  >
                    <option value="asc">↑</option>
                    <option value="desc">↓</option>
                  </select>
                </div>

                {/* Secondary sort */}
                <select
                  data-testid="sheet-sort-secondary"
                  className={styles.select}
                  value={secondaryEntry?.column ?? ''}
                  onChange={(e) => handleSecondaryColumn(e.target.value)}
                >
                  <option value="">{t('sort_no_secondary')}</option>
                  {SORTABLE_COLUMNS.filter((c) => c.id !== primaryEntry.column).map((col) => (
                    <option key={col.id} value={col.id}>{t(col.labelKey)}</option>
                  ))}
                </select>

                <button
                  type="button"
                  data-testid="sheet-clear-sort-btn"
                  className={styles.clearSortBtn}
                  onClick={handleClearSort}
                >
                  {t('sort_clear')}
                </button>
              </div>

              {/* Column picker trigger */}
              <button
                type="button"
                data-testid="sheet-column-picker-trigger"
                className={styles.columnPickerTrigger}
              >
                {t('col_picker_columns_label', {
                  visible: visibleColumns.length,
                  total: visibleColumns.length,
                })}
              </button>

              {/* Apply button */}
              <button
                type="button"
                data-testid="sheet-apply-btn"
                className={styles.applyBtn}
                onClick={() => setIsOpen(false)}
              >
                {t('sheet_apply')}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
