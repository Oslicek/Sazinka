import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ColumnPicker } from './ColumnPicker';
import { ALL_COLUMNS } from '@/lib/customerColumns';
import type { SortEntry } from '@/lib/customerColumns';
import styles from './CustomerFilterBar.module.css';

type GeocodeStatus = 'success' | 'failed' | 'pending';

export interface CustomerFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  geocodeFilter: GeocodeStatus | '';
  onGeocodeFilterChange: (value: GeocodeStatus | '') => void;
  revisionFilter: '' | 'overdue' | 'week' | 'month';
  onRevisionFilterChange: (value: '' | 'overdue' | 'week' | 'month') => void;
  typeFilter: 'company' | 'person' | '';
  onTypeFilterChange: (value: 'company' | 'person' | '') => void;
  activeFilterCount: number;
  onClearAllFilters: () => void;
  isAdvancedOpen: boolean;
  onToggleAdvanced: () => void;
  sortModel: SortEntry[];
  onSortModelChange: (model: SortEntry[]) => void;
  visibleColumns: string[];
  columnOrder: string[];
  onVisibleColumnsChange: (cols: string[]) => void;
  onColumnOrderChange: (order: string[]) => void;
  onResetColumns: () => void;
  viewMode: 'table' | 'cards';
  onViewModeChange: (mode: 'table' | 'cards') => void;
}

const REVISION_CHIPS = [
  { value: '' as const, labelKey: 'filter_revision_all' },
  { value: 'overdue' as const, labelKey: 'filter_revision_overdue' },
  { value: 'week' as const, labelKey: 'filter_revision_week' },
  { value: 'month' as const, labelKey: 'filter_revision_month' },
];

export function CustomerFilterBar({
  search,
  onSearchChange,
  geocodeFilter,
  onGeocodeFilterChange,
  revisionFilter,
  onRevisionFilterChange,
  typeFilter,
  onTypeFilterChange,
  activeFilterCount,
  onClearAllFilters,
  isAdvancedOpen,
  onToggleAdvanced,
  sortModel,
  onSortModelChange,
  visibleColumns,
  columnOrder,
  onVisibleColumnsChange,
  onColumnOrderChange,
  onResetColumns,
  viewMode,
  onViewModeChange,
}: CustomerFilterBarProps) {
  const { t } = useTranslation('customers');
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  const closeColumnPicker = useCallback(() => setIsColumnPickerOpen(false), []);

  useEffect(() => {
    if (!isColumnPickerOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setIsColumnPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isColumnPickerOpen]);

  function handleRevisionChipClick(value: '' | 'overdue' | 'week' | 'month') {
    onRevisionFilterChange(revisionFilter === value ? '' : value);
  }

  return (
    <div className={styles.filterBar}>
      {/* Search */}
      <div className={styles.searchWrapper}>
        <input
          type="text"
          className={styles.search}
          placeholder={t('search_placeholder')}
          aria-label={t('search_placeholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button
            type="button"
            data-testid="search-clear-btn"
            className={styles.searchClear}
            onClick={() => onSearchChange('')}
            aria-label={t('filter_clear_search')}
          >
            ✕
          </button>
        )}
      </div>

      {/* Revision chips */}
      <div className={styles.chipGroup} role="group" aria-label={t('filter_revision_label')}>
        {REVISION_CHIPS.map(({ value, labelKey }) => (
          <button
            key={labelKey}
            type="button"
            className={`${styles.chip} ${revisionFilter === value ? styles.chipActive : ''}`}
            aria-pressed={revisionFilter === value}
            onClick={() => handleRevisionChipClick(value)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Geocode + Type filters side-by-side */}
      <div className={styles.selectGroup}>
        <select
          data-testid="geocode-filter"
          data-active={geocodeFilter !== '' ? 'true' : undefined}
          className={`${styles.filterSelect} ${geocodeFilter ? styles.filterSelectActive : ''}`}
          aria-label={t('filter_address_all')}
          value={geocodeFilter}
          onChange={(e) => onGeocodeFilterChange(e.target.value as GeocodeStatus | '')}
        >
          <option value="">{t('filter_address_all')}</option>
          <option value="success">{t('filter_address_success')}</option>
          <option value="failed">{t('filter_address_failed')}</option>
          <option value="pending">{t('filter_address_pending')}</option>
        </select>

        <select
          data-testid="type-filter"
          className={`${styles.filterSelect} ${typeFilter ? styles.filterSelectActive : ''}`}
          aria-label={t('filter_type_all')}
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value as 'company' | 'person' | '')}
        >
          <option value="">{t('filter_type_all')}</option>
          <option value="company">{t('filter_type_company')}</option>
          <option value="person">{t('filter_type_person')}</option>
        </select>
      </div>

      {/* Active filter badge + clear all */}
      {activeFilterCount > 0 && (
        <>
          <span data-testid="active-filter-badge" className={styles.filterBadge}>
            {activeFilterCount}
          </span>
          <button
            type="button"
            data-testid="clear-all-btn"
            className={styles.clearAllBtn}
            onClick={onClearAllFilters}
          >
            {t('filter_clear_all')}
          </button>
        </>
      )}

      {/* Advanced toggle */}
      <button
        type="button"
        data-testid="advanced-toggle-btn"
        className={`${styles.advancedToggle} ${isAdvancedOpen ? styles.advancedToggleOpen : ''}`}
        aria-expanded={isAdvancedOpen}
        aria-controls="advanced-filter-panel"
        onClick={onToggleAdvanced}
      >
        {t('filter_advanced')}
      </button>

      {/* Column picker (table mode only) */}
      {viewMode === 'table' && (
        <div ref={columnPickerRef} className={styles.columnPickerWrapper}>
          <button
            type="button"
            data-testid="column-picker-trigger"
            className={styles.columnPickerTrigger}
            aria-expanded={isColumnPickerOpen}
            aria-haspopup="dialog"
            onClick={() => setIsColumnPickerOpen((o) => !o)}
          >
            {t('col_picker_columns_label', {
              visible: visibleColumns.length,
              total: ALL_COLUMNS.length,
            })}
          </button>
          {isColumnPickerOpen && (
            <ColumnPicker
              visibleColumns={visibleColumns}
              columnOrder={columnOrder}
              sortModel={sortModel}
              onVisibleColumnsChange={onVisibleColumnsChange}
              onColumnOrderChange={onColumnOrderChange}
              onSortModelChange={onSortModelChange}
              onReset={onResetColumns}
              onClose={closeColumnPicker}
            />
          )}
        </div>
      )}

      {/* View mode toggle — pushed to end */}
      <div className={styles.viewToggle}>
        <button
          type="button"
          data-testid="view-table-btn"
          className={`${styles.viewButton} ${viewMode === 'table' ? styles.active : ''}`}
          aria-pressed={viewMode === 'table'}
          aria-label={t('view_table')}
          onClick={() => onViewModeChange('table')}
          title={t('view_table')}
        >
          ☰
        </button>
        <button
          type="button"
          data-testid="view-cards-btn"
          className={`${styles.viewButton} ${viewMode === 'cards' ? styles.active : ''}`}
          aria-pressed={viewMode === 'cards'}
          aria-label={t('view_cards')}
          onClick={() => onViewModeChange('cards')}
          title={t('view_cards')}
        >
          ▦
        </button>
      </div>
    </div>
  );
}
