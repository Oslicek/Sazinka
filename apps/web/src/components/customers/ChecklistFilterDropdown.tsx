import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChecklistFilter, ColumnDistinctRequest } from '@shared/customer';
import { getColumnDistinctValues } from '@/services/customerService';
import type { CustomerServiceDeps } from '@/services/customerService';
import styles from './ChecklistFilterDropdown.module.css';

export interface ChecklistFilterDropdownProps {
  columnId: string;
  /** The current filter (for edit mode pre-selection). */
  currentFilter?: ChecklistFilter | null;
  /** Context filters to narrow distinct values. */
  contextRequest?: Omit<ColumnDistinctRequest, 'column'>;
  onApply: (filter: ChecklistFilter) => void;
  onClear: () => void;
  onClose: () => void;
  /** Injectable service deps for testing. */
  deps?: CustomerServiceDeps;
}

/** i18n label overrides for known enum columns. */
function getValueLabel(columnId: string, value: string, t: (key: string) => string): string {
  if (value === '') return t('filter_empty_value');
  if (columnId === 'type') {
    if (value === 'company') return t('customer_type_company');
    if (value === 'person') return t('customer_type_person');
  }
  if (columnId === 'geocodeStatus') {
    if (value === 'success') return t('geocode_status_success');
    if (value === 'pending') return t('geocode_status_pending');
    if (value === 'failed') return t('geocode_status_failed');
  }
  return value;
}

export function ChecklistFilterDropdown({
  columnId,
  currentFilter,
  contextRequest,
  onApply,
  onClear,
  onClose,
  deps,
}: ChecklistFilterDropdownProps) {
  const { t } = useTranslation();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(currentFilter?.values ?? [])
  );

  // Fetch distinct values
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const request: ColumnDistinctRequest = {
      column: columnId,
      limit: 200,
      offset: 0,
      ...contextRequest,
    };

    getColumnDistinctValues(request, deps)
      .then((resp) => {
        if (!cancelled) {
          setValues(resp.values);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [columnId, deps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const filteredValues = search.trim()
    ? values.filter((v) => v.toLowerCase().includes(search.toLowerCase()))
    : values;

  const toggleValue = useCallback((v: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(filteredValues));
  }, [filteredValues]);

  const handleDeselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleApply = useCallback(() => {
    if (selected.size === 0) return;
    onApply({ type: 'checklist', column: columnId, values: Array.from(selected) });
    onClose();
  }, [selected, columnId, onApply, onClose]);

  const handleClear = useCallback(() => {
    setSelected(new Set());
    onClear();
    onClose();
  }, [onClear, onClose]);

  return (
    <div
      ref={dropdownRef}
      className={styles.dropdown}
      role="dialog"
      aria-label={t('filter_dropdown_label', { column: columnId })}
    >
      {/* Search input */}
      <div className={styles.searchRow}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('filter_search_placeholder')}
          aria-label={t('filter_search_label')}
          className={styles.searchInput}
        />
      </div>

      {/* Select all / Deselect all */}
      <div className={styles.selectAllRow}>
        <button
          type="button"
          onClick={handleSelectAll}
          className={styles.linkButton}
          aria-label={t('filter_select_all')}
        >
          {t('filter_select_all')}
        </button>
        <span className={styles.separator}>·</span>
        <button
          type="button"
          onClick={handleDeselectAll}
          className={styles.linkButton}
          aria-label={t('filter_deselect_all')}
        >
          {t('filter_deselect_all')}
        </button>
      </div>

      {/* Value list */}
      <div className={styles.valueList} role="group" aria-label={t('filter_values_label')}>
        {loading && (
          <div className={styles.loadingMessage} data-testid="checklist-loading">
            {t('filter_loading')}
          </div>
        )}
        {error && (
          <div className={styles.errorMessage} data-testid="checklist-error">
            {t('filter_error')}: {error}
          </div>
        )}
        {!loading && !error && filteredValues.length === 0 && (
          <div className={styles.emptyMessage} data-testid="checklist-no-results">
            {t('filter_no_results')}
          </div>
        )}
        {!loading && !error && filteredValues.map((v) => (
          <label key={v} className={styles.valueRow}>
            <input
              type="checkbox"
              checked={selected.has(v)}
              onChange={() => toggleValue(v)}
              aria-label={getValueLabel(columnId, v, t)}
            />
            <span className={styles.valueLabel}>
              {getValueLabel(columnId, v, t)}
            </span>
          </label>
        ))}
      </div>

      {/* Footer actions */}
      <div className={styles.footer}>
        <button
          type="button"
          onClick={handleClear}
          className={styles.clearButton}
          aria-label={t('filter_clear')}
        >
          {t('filter_clear')}
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={selected.size === 0}
          className={styles.applyButton}
          aria-label={t('filter_apply')}
        >
          {t('filter_apply')}
        </button>
      </div>
    </div>
  );
}
