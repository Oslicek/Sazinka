import styles from './DraftModeBar.module.css';

interface DraftModeBarProps {
  hasChanges: boolean;
  isSaving?: boolean;
  lastSaved?: Date | null;
  saveError?: string | null;
  onRetry?: () => void;
}

function formatLastSaved(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'právě teď';
  if (diffMin < 60) return `před ${diffMin} min`;

  return date.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DraftModeBar({
  hasChanges,
  isSaving,
  lastSaved,
  saveError,
  onRetry,
}: DraftModeBarProps) {
  // Error state — takes priority
  if (saveError) {
    return (
      <div className={`${styles.container} ${styles.hasError}`}>
        <span className={styles.icon}>⚠️</span>
        <span className={styles.errorMessage}>Nepodařilo se uložit</span>
        {onRetry && (
          <button
            type="button"
            className={styles.retryButton}
            onClick={onRetry}
          >
            Zkusit znovu
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
        <span className={styles.savingMessage}>Ukládám...</span>
      </div>
    );
  }

  // Has unsaved changes (waiting for debounce)
  if (hasChanges) {
    return (
      <div className={styles.container}>
        <span className={styles.icon}>●</span>
        <span className={styles.pendingMessage}>Neuložené změny</span>
      </div>
    );
  }

  // Successfully saved
  if (lastSaved) {
    return (
      <div className={styles.container}>
        <span className={styles.icon}>✓</span>
        <span className={styles.savedMessage}>
          Uloženo {formatLastSaved(lastSaved)}
        </span>
      </div>
    );
  }

  // Nothing to show
  return null;
}
