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
}

export function RouteSummaryActions({
  onOptimize,
  onAddBreak,
  onDeleteRoute,
  isOptimizing = false,
  canOptimize = true,
  deleteLabel,
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
      {onDeleteRoute && (
        <button type="button" className={styles.summaryDeleteBtn} onClick={() => {
          // #region agent log
          console.log('[DEBUG] Delete route button clicked');
          fetch('http://127.0.0.1:7353/ingest/1d957424-b904-4bc5-af34-a37ca7963434',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2ba648'},body:JSON.stringify({sessionId:'2ba648',location:'RouteSummaryActions.tsx:click',message:'Delete route button clicked',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'H6d'})}).catch(()=>{});
          // #endregion
          onDeleteRoute();
        }}>
          {deleteLabel ?? t('actions_delete_route')}
        </button>
      )}
    </div>
  );
}
