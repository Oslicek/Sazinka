import { useTranslation } from 'react-i18next';
import type { NoteHistoryEntry } from '@shared/note';
import styles from './NoteHistory.module.css';

interface NoteHistoryProps {
  entries: NoteHistoryEntry[];
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

export function NoteHistory({ entries }: NoteHistoryProps) {
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
              <span className={styles.editorName} title={entry.editedByUserId}>
                {t('notes_history_user', 'User')} {entry.editedByUserId.slice(0, 8)}
              </span>
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
              {entry.content.length > 200 ? entry.content.slice(0, 200) + '…' : entry.content}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
