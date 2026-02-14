/**
 * RevisionStatusActions - Context-aware CTA actions based on revision status
 * 
 * Actions by status:
 * - upcoming → Domluvit termín, Odložit
 * - scheduled → Změnit termín, Přesunout, Zrušit
 * - in_progress → Na místě, Hotovo
 * - completed → Zobrazit výsledek
 */

import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');
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
          📅 {t('revision_action_schedule')}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onSnooze}
          disabled={isDisabled}
        >
          ⏰ {t('revision_action_snooze')}
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
          🗓️ {t('revision_action_open_plan')}
        </Link>
        <button
          type="button"
          className={styles.action}
          onClick={onReschedule}
          disabled={isDisabled}
        >
          🔄 {t('revision_action_reschedule')}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={onSnooze}
          disabled={isDisabled}
        >
          ⏰ {t('revision_action_snooze')}
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.danger}`}
          onClick={onCancel}
          disabled={isDisabled}
        >
          ❌ {t('revision_action_cancel')}
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
            📍 {t('revision_action_arrived')}
          </button>
        )}
        <button
          type="button"
          className={`${styles.action} ${styles.success}`}
          onClick={onComplete}
          disabled={isDisabled}
        >
          ✅ {t('revision_action_done')}
        </button>
      </>
    ),
    completed: (
      <div className={styles.completedInfo}>
        <span className={styles.completedIcon}>✅</span>
        <span>{t('revision_action_completed')}</span>
        {revision.result && (
          <span className={`${styles.resultBadge} ${styles[`result-${revision.result}`]}`}>
            {t(`revision_result.${revision.result}`)}
          </span>
        )}
      </div>
    ),
    cancelled: (
      <div className={styles.cancelledInfo}>
        <span className={styles.cancelledIcon}>❌</span>
        <span>{t('revision_action_cancelled')}</span>
      </div>
    ),
  };

  // Phone call action (always available)
  const phoneAction = revision.customerPhone && (
    <a
      href={`tel:${revision.customerPhone}`}
      className={styles.action}
    >
      📞 {t('revision_action_call')}
    </a>
  );

  return (
    <div className={`${styles.container} ${styles[variant]}`}>
      {actions[state]}
      {variant === 'sidebar' && phoneAction}
    </div>
  );
}
