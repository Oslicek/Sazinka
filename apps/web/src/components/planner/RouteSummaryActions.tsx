import { useTranslation } from 'react-i18next';
import styles from './RouteSummaryActions.module.css';

export interface RouteSummaryActionsProps {
  /** Handler for optimize button */
  onOptimize?: () => void;
  /** Handler for add break button */
  onAddBreak?: () => void;
  /** Handler for delete route button */
  onDeleteRoute?: () => void;
  /** Whether optimization is in progress */
  isOptimizing?: boolean;
  /** Whether the route can be optimized (needs at least 2 stops) */
  canOptimize?: boolean;
  /** Label for delete button */
  deleteLabel?: string;
  /** Handler for print action */
  onPrint?: () => void;
  /** Handler for Google Maps export action */
  onExportGoogleMaps?: () => void;
  /** Whether print is available (map ready + stops present). Defaults to true if onPrint provided. */
  canPrint?: boolean;
  /** Whether Google Maps export is available (stops have coords). Defaults to true if onExportGoogleMaps provided. */
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
  onExportGoogleMaps,
  canPrint = true,
  canExport = true,
}: RouteSummaryActionsProps) {
  const { t } = useTranslation('planner');
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
      {onExportGoogleMaps && (
        <button
          type="button"
          className={styles.summaryActionBtn}
          onClick={onExportGoogleMaps}
          disabled={!canExport}
          title={t('actions_export_gmaps')}
          aria-label={t('actions_export_gmaps')}
        >
          {t('actions_export_gmaps')}
        </button>
      )}
      {onDeleteRoute && (
        <button type="button" className={styles.summaryDeleteBtn} onClick={onDeleteRoute}>
          {deleteLabel ?? t('actions_delete_route')}
        </button>
      )}
    </div>
  );
}
