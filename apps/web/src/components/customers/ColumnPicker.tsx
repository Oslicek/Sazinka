/**
 * ColumnPicker — popover body for managing visible columns and column order.
 *
 * This is a controlled component — the parent manages open/close state
 * and renders the trigger button. ColumnPicker only renders the popover
 * content and the sort-conflict confirmation modal.
 *
 * Features:
 * - Grouped by category with headings
 * - Checkbox visibility toggle (core columns locked)
 * - MAX_VISIBLE_COLUMNS limit enforced; exceeding columns disabled
 * - Blocking modal when hiding a sorted column (single aggregated modal)
 * - Drag-and-drop reorder via drag handles (keyboard + mouse)
 * - Escape closes via onClose callback
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ALL_COLUMNS,
  COLUMN_CATEGORIES,
  CORE_COLUMN_IDS,
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  MAX_VISIBLE_COLUMNS,
} from '../../lib/customerColumns';
import type { SortEntry } from '../../lib/customerColumns';
import styles from './ColumnPicker.module.css';

export interface ColumnPickerProps {
  visibleColumns: string[];
  columnOrder: string[];
  sortModel: SortEntry[];
  onVisibleColumnsChange: (cols: string[]) => void;
  onColumnOrderChange: (order: string[]) => void;
  onSortModelChange: (model: SortEntry[]) => void;
  onReset: () => void;
  onClose: () => void;
}

interface ConfirmState {
  hidingColumns: string[];
  affectedSortEntries: SortEntry[];
  pendingVisible: string[];
  isReset: boolean;
}

function buildAffectedSort(
  sortModel: SortEntry[],
  hidingColumns: string[],
): SortEntry[] {
  return sortModel.filter((e) => hidingColumns.includes(e.column));
}

function removeFromSort(sortModel: SortEntry[], hidingColumns: string[]): SortEntry[] {
  const next = sortModel.filter((e) => !hidingColumns.includes(e.column));
  return next.length > 0 ? next : [...DEFAULT_SORT_MODEL];
}

/** Human-readable title when i18n returns no string for the label key. */
export function fallbackColumnTitle(labelKey: string): string {
  const rest = labelKey.startsWith('col_') ? labelKey.slice(4) : labelKey;
  return rest.replace(/_/g, ' ');
}

function resolveColumnDisplayName(
  t: (key: string, opts?: { defaultValue?: string }) => string,
  labelKey: string,
): string {
  const raw = t(labelKey, { defaultValue: '' });
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || fallbackColumnTitle(labelKey);
}

export function ColumnPicker({
  visibleColumns,
  columnOrder,
  sortModel,
  onVisibleColumnsChange,
  onColumnOrderChange,
  onSortModelChange,
  onReset,
  onClose,
}: ColumnPickerProps) {
  const { t } = useTranslation('customers');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const orderedColumns = [
    ...columnOrder.filter((id) => ALL_COLUMNS.some((c) => c.id === id)),
    ...ALL_COLUMNS.filter((c) => !columnOrder.includes(c.id)).map((c) => c.id),
  ];

  const visibleSet = new Set(visibleColumns);
  const atMax = visibleColumns.length >= MAX_VISIBLE_COLUMNS;

  const handleToggleColumn = useCallback(
    (columnId: string) => {
      const col = ALL_COLUMNS.find((c) => c.id === columnId);
      if (!col || col.core) return;

      const isVisible = visibleSet.has(columnId);

      if (isVisible) {
        const affected = buildAffectedSort(sortModel, [columnId]);
        const pending = visibleColumns.filter((id) => id !== columnId);
        if (affected.length > 0) {
          setConfirmState({
            hidingColumns: [columnId],
            affectedSortEntries: affected,
            pendingVisible: pending,
            isReset: false,
          });
          return;
        }
        onVisibleColumnsChange(pending);
      } else {
        if (atMax) return;
        onVisibleColumnsChange([...visibleColumns, columnId]);
      }
    },
    [visibleColumns, visibleSet, sortModel, atMax, onVisibleColumnsChange],
  );

  const handleReset = useCallback(() => {
    const afterReset = DEFAULT_VISIBLE_COLUMNS;
    const hiding = visibleColumns.filter((id) => !afterReset.includes(id));
    const affected = buildAffectedSort(sortModel, hiding);
    if (affected.length > 0) {
      setConfirmState({
        hidingColumns: hiding,
        affectedSortEntries: affected,
        pendingVisible: afterReset,
        isReset: true,
      });
      return;
    }
    onReset();
  }, [visibleColumns, sortModel, onReset]);

  const handleConfirm = useCallback(() => {
    if (!confirmState) return;
    const newSort = removeFromSort(sortModel, confirmState.hidingColumns);
    onVisibleColumnsChange(confirmState.pendingVisible);
    onSortModelChange(newSort);
    if (confirmState.isReset) onReset();
    setConfirmState(null);
  }, [confirmState, sortModel, onVisibleColumnsChange, onSortModelChange, onReset]);

  const handleCancel = useCallback(() => setConfirmState(null), []);

  const dragItemRef = useRef<string | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, columnId: string) => {
      dragItemRef.current = columnId;
      e.dataTransfer.setData('text/plain', columnId);
      e.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null;
  }, []);

  const handleDragOverRow = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const dragId =
        dragItemRef.current ||
        (() => {
          try {
            return e.dataTransfer.getData('text/plain');
          } catch {
            return null;
          }
        })();
      if (!dragId || dragId === targetId) return;
      const newOrder = [...orderedColumns];
      const fromIdx = newOrder.indexOf(dragId);
      const toIdx = newOrder.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, dragId);
      onColumnOrderChange(newOrder);
      dragItemRef.current = null;
    },
    [orderedColumns, onColumnOrderChange],
  );

  const columnsByCategory = COLUMN_CATEGORIES.map((cat) => ({
    category: cat,
    columns: orderedColumns
      .map((id) => ALL_COLUMNS.find((c) => c.id === id))
      .filter((c) => c?.category === cat)
      .map((c) => c!),
  })).filter((g) => g.columns.length > 0);

  return (
    <>
      <div
        className={styles.popover}
        role="dialog"
        aria-label={t('col_picker_columns_label', {
          visible: visibleColumns.length,
          total: ALL_COLUMNS.length,
        })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className={styles.popoverHeader}>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            {t('col_picker_reset')}
          </button>
        </div>

        {atMax && (
          <div className={styles.maxHint}>
            {t('col_picker_max_limit', { max: MAX_VISIBLE_COLUMNS })}
          </div>
        )}

        {columnsByCategory.map(({ category, columns }) => (
          <div key={category} className={styles.categorySection}>
            <h3 role="heading" className={styles.categoryHeading}>
              {t(`col_category_${category}`)}
            </h3>
            {columns.map((col) => {
              const isVisible = visibleSet.has(col.id);
              const isCore = CORE_COLUMN_IDS.includes(col.id);
              const isDisabled = isCore || (!isVisible && atMax);
              const displayName = resolveColumnDisplayName(t, col.labelKey);

              return (
                <div
                  key={col.id}
                  className={`${styles.columnRow} ${isDisabled ? styles.disabled : ''}`}
                  onDragOver={handleDragOverRow}
                  onDrop={(e) => handleDrop(e, col.id)}
                  title={!isVisible && atMax ? t('col_picker_max_limit', { max: MAX_VISIBLE_COLUMNS }) : undefined}
                >
                  <span
                    role="button"
                    tabIndex={-1}
                    className={styles.dragHandle}
                    aria-label={t('col_picker_drag_reorder', { column: displayName })}
                    draggable={!isCore}
                    onDragStart={(e) => handleDragStart(e, col.id)}
                    onDragEnd={handleDragEnd}
                  >
                    ⠿
                  </span>
                  <span className={styles.columnName}>{displayName}</span>
                  <input
                    type="checkbox"
                    id={`col-pick-${col.id}`}
                    className={styles.checkbox}
                    checked={isVisible}
                    disabled={isDisabled}
                    aria-label={displayName}
                    onChange={() => handleToggleColumn(col.id)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {confirmState && (
        <div className={styles.modalOverlay}>
          <div
            className={styles.modal}
            role="dialog"
            aria-labelledby="col-pick-modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCancel();
            }}
            tabIndex={-1}
          >
            <h2 id="col-pick-modal-title" className={styles.modalTitle}>
              {t('col_picker_sort_warning_title')}
            </h2>
            <div className={styles.modalBody}>
              {t('col_picker_sort_warning_body')}
              <ul className={styles.affectedList}>
                {confirmState.affectedSortEntries.map((e) => {
                  const labelKey = ALL_COLUMNS.find((c) => c.id === e.column)?.labelKey ?? e.column;
                  const affectedDisplayName = resolveColumnDisplayName(t, labelKey);
                  return (
                    <li key={e.column}>
                      {affectedDisplayName}{' '}
                      {e.direction === 'asc' ? '↑' : '↓'}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={handleCancel}>
                {t('col_picker_cancel')}
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirm}>
                {t('col_picker_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
