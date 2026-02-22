import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { formatTime } from '../../i18n/formatters';
import styles from './DraftModeBar.module.css';

interface DraftModeBarProps {
  hasChanges: boolean;
  isSaving?: boolean;
  lastSaved?: Date | null;
  saveError?: string | null;
  onRetry?: () => void;
}

function formatLastSaved(
  date: Date,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return t('draft_just_now');
  if (diffMin < 60) return t('draft_minutes_ago', { minutes: diffMin });

  return formatTime(date.toISOString());
}

export function DraftModeBar({
  hasChanges,
  isSaving,
  lastSaved,
  saveError,
  onRetry,
}: DraftModeBarProps) {
  const { t } = useTranslation('planner');

  // Error state — takes priority
  if (saveError) {
    return (
      <div className={`${styles.container} ${styles.hasError}`}>
        <AlertTriangle size={16} className={styles.icon} />
        <span className={styles.errorMessage}>{t('draft_save_error')}</span>
        {onRetry && (
          <button
            type="button"
            className={styles.retryButton}
            onClick={onRetry}
          >
            {t('draft_retry')}
          </button>
        )}
      </div>
    );
  }

  // Currently saving
  if (isSaving) {
    return (
      <div className={styles.container}>
        <span className={styles.icon}>⟳</span>
        <span className={styles.savingMessage}>{t('draft_saving')}</span>
      </div>
    );
  }

  // Has unsaved changes (waiting for debounce)
  if (hasChanges) {
    return (
      <div className={styles.container}>
        <span className={styles.icon}>●</span>
        <span className={styles.pendingMessage}>{t('draft_unsaved')}</span>
      </div>
    );
  }

  // Successfully saved
  if (lastSaved) {
    return (
      <div className={styles.container}>
        <span className={styles.icon}>✓</span>
        <span className={styles.savedMessage}>
          {t('draft_saved', { time: formatLastSaved(lastSaved, t) })}
        </span>
      </div>
    );
  }

  // Nothing to show
  return null;
}
