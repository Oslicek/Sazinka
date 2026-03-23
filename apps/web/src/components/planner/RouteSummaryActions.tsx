import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './RouteSummaryActions.module.css';

export type ExportTarget = 'google_maps' | 'mapy_cz';

export interface RouteSummaryActionsProps {
  onOptimize?: () => void;
  onAddBreak?: () => void;
  onDeleteRoute?: () => void;
  isOptimizing?: boolean;
  canOptimize?: boolean;
  deleteLabel?: string;
  onPrint?: () => void;
  /** Called with the selected export target */
  onExport?: (target: ExportTarget) => void;
  /** @deprecated use onExport instead */
  onExportGoogleMaps?: () => void;
  canPrint?: boolean;
  canExport?: boolean;
}

export function RouteSummaryActions({
  onOptimize,
  onAddBreak,
  onDeleteRoute,
  isOptimizing = false,
  canOptimize = true,
  deleteLabel,
  onPrint,
  onExport,
  onExportGoogleMaps,
  canPrint = true,
  canExport = true,
}: RouteSummaryActionsProps) {
  const { t } = useTranslation('planner');
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback((target: ExportTarget) => {
    setShowExportDropdown(false);
    if (onExport) {
      onExport(target);
    } else if (target === 'google_maps' && onExportGoogleMaps) {
      onExportGoogleMaps();
    }
  }, [onExport, onExportGoogleMaps]);

  useEffect(() => {
    if (!showExportDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportDropdown]);

  const hasExport = !!(onExport || onExportGoogleMaps);

  return (
    <div className={styles.summaryActions}>
      {onOptimize && (
        <button
          type="button"
          className={styles.summaryOptimizeBtn}
          onClick={onOptimize}
          disabled={isOptimizing || !canOptimize}
        >
          {isOptimizing ? t('optimizer_running') : t('actions_optimize')}
        </button>
      )}
      {onAddBreak && (
        <button type="button" className={styles.summaryActionBtn} onClick={onAddBreak}>
          {t('actions_break')}
        </button>
      )}
      {onPrint && (
        <button
          type="button"
          className={styles.summaryActionBtn}
          onClick={onPrint}
          disabled={!canPrint}
          title={t('actions_print')}
          aria-label={t('actions_print')}
        >
          {t('actions_print')}
        </button>
      )}
      {hasExport && (
        <div className={styles.exportButtonWrapper} ref={dropdownRef}>
          <button
            type="button"
            className={styles.exportPrimaryBtn}
            onClick={() => handleExport('google_maps')}
            disabled={!canExport}
          >
            {t('actions_export')}
          </button>
          <button
            type="button"
            className={styles.exportDropdownToggle}
            onClick={() => setShowExportDropdown(!showExportDropdown)}
            disabled={!canExport}
            aria-haspopup="true"
            aria-expanded={showExportDropdown}
            aria-label={t('actions_export_more')}
          >
            ▼
          </button>
          {showExportDropdown && (
            <div className={styles.exportDropdown} role="menu">
              <button
                type="button"
                className={styles.exportOption}
                role="menuitem"
                onClick={() => handleExport('google_maps')}
              >
                {t('actions_export_gmaps')}
              </button>
              <button
                type="button"
                className={styles.exportOption}
                role="menuitem"
                onClick={() => handleExport('mapy_cz')}
              >
                {t('actions_export_mapycz')}
              </button>
            </div>
          )}
        </div>
      )}
      {onDeleteRoute && (
        <button type="button" className={styles.summaryDeleteBtn} onClick={onDeleteRoute}>
          {deleteLabel ?? t('actions_delete_route')}
        </button>
      )}
    </div>
  );
}
