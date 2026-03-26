import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateRangeFilter } from '@shared/customer';
import styles from './DateRangeFilterDropdown.module.css';

export interface DateRangeFilterDropdownProps {
  columnId: string;
  /** The current filter (for edit mode pre-population). */
  currentFilter?: DateRangeFilter | null;
  onApply: (filter: DateRangeFilter) => void;
  onClear: () => void;
  onClose: () => void;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_REGEX.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

export function DateRangeFilterDropdown({
  columnId,
  currentFilter,
  onApply,
  onClear,
  onClose,
}: DateRangeFilterDropdownProps) {
  const { t } = useTranslation();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [from, setFrom] = useState(currentFilter?.from ?? '');
  const [to, setTo] = useState(currentFilter?.to ?? '');

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

  // Validate: at least one bound; if both present, from <= to; each must be valid date
  const fromValid = from === '' || isValidDate(from);
  const toValid = to === '' || isValidDate(to);
  const rangeValid = from === '' || to === '' || from <= to;
  const hasAtLeastOneBound = from !== '' || to !== '';
  const canApply = hasAtLeastOneBound && fromValid && toValid && rangeValid;

  let validationError: string | null = null;
  if (from !== '' && !isValidDate(from)) validationError = t('filter_date_invalid_from');
  else if (to !== '' && !isValidDate(to)) validationError = t('filter_date_invalid_to');
  else if (from !== '' && to !== '' && from > to) validationError = t('filter_date_range_invalid');

  const handleApply = useCallback(() => {
    if (!canApply) return;
    const filter: DateRangeFilter = {
      type: 'dateRange',
      column: columnId,
      ...(from !== '' ? { from } : {}),
      ...(to !== '' ? { to } : {}),
    };
    onApply(filter);
    onClose();
  }, [canApply, from, to, columnId, onApply, onClose]);

  const handleClear = useCallback(() => {
    setFrom('');
    setTo('');
    onClear();
    onClose();
  }, [onClear, onClose]);

  return (
    <div
      ref={dropdownRef}
      className={styles.dropdown}
      role="dialog"
      aria-label={t('filter_date_range_label', { column: columnId })}
    >
      <div className={styles.fields}>
        <label className={styles.fieldLabel}>
          <span>{t('filter_date_from')}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label={t('filter_date_from')}
            className={styles.dateInput}
          />
        </label>

        <label className={styles.fieldLabel}>
          <span>{t('filter_date_to')}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label={t('filter_date_to')}
            className={styles.dateInput}
          />
        </label>
      </div>

      {validationError && (
        <div className={styles.validationError} data-testid="date-range-error">
          {validationError}
        </div>
      )}

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
          disabled={!canApply}
          className={styles.applyButton}
          aria-label={t('filter_apply')}
        >
          {t('filter_apply')}
        </button>
      </div>
    </div>
  );
}
