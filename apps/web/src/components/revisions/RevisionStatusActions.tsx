/**
 * RevisionStatusActions - Context-aware CTA actions based on revision status
 * 
 * Actions by status:
 * - upcoming → Domluvit termín, Odložit
 * - scheduled → Změnit termín, Přesunout, Zrušit
 * - in_progress → Na místě, Hotovo
 * - completed → Zobrazit výsledek
 */

import { Link } from '@tanstack/react-router';
import type { Revision } from '@shared/revision';
import styles from './RevisionStatusActions.module.css';

type WorkflowState = 'upcoming' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

interface RevisionStatusActionsProps {
  revision: Revision;
  onSchedule: () => void;
  onReschedule: () => void;
  onSnooze: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onArrived?: () => void;
  isSubmitting?: boolean;
  variant?: 'header' | 'sidebar';
}

function getWorkflowState(revision: Revision): WorkflowState {
  if (revision.status === 'completed') return 'completed';
  if (revision.status === 'cancelled') return 'cancelled';
  // 'in_progress' is not a stored RevisionStatus; skip this check
  if (revision.scheduledDate) return 'scheduled';
  return 'upcoming';
}

export function RevisionStatusActions({
  revision,
  onSchedule,
  onReschedule,
  onSnooze,
  onComplete,
  onCancel,
  onArrived,
  isSubmitting = false,
  variant = 'header',
}: RevisionStatusActionsProps) {
  const state = getWorkflowState(revision);
  const isDisabled = isSubmitting || state === 'completed' || state === 'cancelled';

  // Render nothing for completed/cancelled in header variant
  if (variant === 'header' && (state === 'completed' || state === 'cancelled')) {
    return null;
  }

  // Actions based on workflow state
  const actions = {
    upcoming: (
      <>
        <button
          type="button"
          className={`${styles.action} ${styles.primary}`}
          onClick={onSchedule}
          disabled={isDisabled}
        >
          📅 Domluvit termín
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onSnooze}
          disabled={isDisabled}
        >
          ⏰ Odložit
        </button>
      </>
    ),
    scheduled: (
      <>
        <Link
          to="/planner"
          search={{ date: revision.scheduledDate }}
          className={`${styles.action} ${styles.primary}`}
        >
          🗓️ Otevřít v plánu
        </Link>
        <button
          type="button"
          className={styles.action}
          onClick={onReschedule}
          disabled={isDisabled}
        >
          🔄 Změnit termín
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onSnooze}
          disabled={isDisabled}
        >
          ⏰ Odložit
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.danger}`}
          onClick={onCancel}
          disabled={isDisabled}
        >
          ❌ Zrušit
        </button>
      </>
    ),
    in_progress: (
      <>
        {onArrived && (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            onClick={onArrived}
            disabled={isDisabled}
          >
            📍 Na místě
          </button>
        )}
        <button
          type="button"
          className={`${styles.action} ${styles.success}`}
          onClick={onComplete}
          disabled={isDisabled}
        >
          ✅ Hotovo
        </button>
      </>
    ),
    completed: (
      <div className={styles.completedInfo}>
        <span className={styles.completedIcon}>✅</span>
        <span>Revize dokončena</span>
        {revision.result && (
          <span className={`${styles.resultBadge} ${styles[`result-${revision.result}`]}`}>
            {revision.result === 'passed' ? 'V pořádku' : 
             revision.result === 'conditional' ? 'S výhradami' : 'Nevyhovělo'}
          </span>
        )}
      </div>
    ),
    cancelled: (
      <div className={styles.cancelledInfo}>
        <span className={styles.cancelledIcon}>❌</span>
        <span>Revize zrušena</span>
      </div>
    ),
  };

  // Phone call action (always available)
  const phoneAction = revision.customerPhone && (
    <a
      href={`tel:${revision.customerPhone}`}
      className={styles.action}
    >
      📞 Zavolat
    </a>
  );

  return (
    <div className={`${styles.container} ${styles[variant]}`}>
      {actions[state]}
      {variant === 'sidebar' && phoneAction}
    </div>
  );
}
