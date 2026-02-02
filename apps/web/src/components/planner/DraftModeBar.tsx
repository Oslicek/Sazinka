import styles from './DraftModeBar.module.css';

interface DraftModeBarProps {
  hasChanges: boolean;
  isSaving?: boolean;
  lastSaved?: Date | null;
  onSave: () => void;
  onDiscard: () => void;
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
  onSave,
  onDiscard,
}: DraftModeBarProps) {
  if (!hasChanges && !lastSaved) {
    return null;
  }

  return (
    <div className={`${styles.container} ${hasChanges ? styles.hasChanges : ''}`}>
      {hasChanges ? (
        <>
          <span className={styles.icon}>⚠️</span>
          <span className={styles.message}>Neuložené změny</span>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.discardButton}
              onClick={onDiscard}
              disabled={isSaving}
            >
              Zahodit
            </button>
            <button
              type="button"
              className={styles.saveButton}
              onClick={onSave}
              disabled={isSaving}
            >
              {isSaving ? 'Ukládám...' : 'Uložit'}
            </button>
          </div>
        </>
      ) : lastSaved ? (
        <>
          <span className={styles.icon}>✓</span>
          <span className={styles.savedMessage}>
            Uloženo {formatLastSaved(lastSaved)}
          </span>
        </>
      ) : null}
    </div>
  );
}
