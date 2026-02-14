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
  /** Label for delete button (default: "Smazat trasu") */
  deleteLabel?: string;
}

export function RouteSummaryActions({
  onOptimize,
  onAddBreak,
  onDeleteRoute,
  isOptimizing = false,
  canOptimize = true,
  deleteLabel = 'Smazat trasu',
}: RouteSummaryActionsProps) {
  return (
    <div className={styles.summaryActions}>
      {onOptimize && (
        <button
          type="button"
          className={styles.summaryOptimizeBtn}
          onClick={onOptimize}
          disabled={isOptimizing || !canOptimize}
        >
          {isOptimizing ? 'Optimalizuji...' : 'Optimalizovat'}
        </button>
      )}
      {onAddBreak && (
        <button type="button" className={styles.summaryActionBtn} onClick={onAddBreak}>
          Pauza
        </button>
      )}
      {onDeleteRoute && (
        <button type="button" className={styles.summaryDeleteBtn} onClick={onDeleteRoute}>
          {deleteLabel}
        </button>
      )}
    </div>
  );
}
