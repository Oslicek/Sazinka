import { useTranslation } from 'react-i18next';
import type { NotesHistoryEntry } from '@shared/visit';
import styles from './NotesHistory.module.css';

interface NotesHistoryProps {
  entries: NotesHistoryEntry[];
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function NotesHistory({ entries }: NotesHistoryProps) {
  const { t } = useTranslation('common');

  if (entries.length === 0) {
    return (
      <div className={styles.empty} data-testid="history-empty">
        {t('notes_history_empty', 'No edit history')}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h4 className={styles.title}>{t('notes_history_title', 'Edit history')}</h4>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry} data-testid="history-entry">
            <div className={styles.entryHeader}>
              <span className={styles.editorName}>{entry.editedByName ?? entry.editedByUserId}</span>
              <span className={styles.date}>{formatDate(entry.lastEditedAt)}</span>
              {entry.changeCount > 1 && (
                <span className={styles.badge} data-testid="change-count">
                  {entry.changeCount} {t('notes_history_edits', 'edits')}
                </span>
              )}
              {entry.changeCount === 1 && (
                <span className={styles.badge} data-testid="change-count">
                  {entry.changeCount} {t('notes_history_edit', 'edit')}
                </span>
              )}
            </div>
            <div className={styles.preview}>
              {entry.fieldNotes.length > 200
                ? entry.fieldNotes.slice(0, 200) + '…'
                : entry.fieldNotes}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
