/**
 * InlineNoteEditor — shared note row component used in Visit, Customer, and WorkItem pages.
 *
 * Encapsulates: useNoteDraft (draft + conflict) + useAutoSave (debounced save + error) + NoteEditor.
 * Keeps the three pages in sync: add delete/audit features here, they appear everywhere.
 */
import { useState } from 'react';
import { AlertTriangle, Trash2, History } from 'lucide-react';
import type { Note, NoteHistoryEntry } from '@shared/note';
import { NoteEditor } from './NoteEditor';
import { NoteHistory } from './NoteHistory';
import { useNoteDraft } from '../../hooks/useNoteDraft';
import { useAutoSave } from '../../hooks/useAutoSave';
import { updateNote, deleteNote, fetchNoteAudit } from '../../services/noteService';

export interface InlineNoteEditorProps {
  note: Note;
  sessionId: string;
  onSaved: (updated: Note) => void;
  /** If provided, a delete button is shown; called with the noteId on successful deletion. */
  onDeleted?: (noteId: string) => void;
}

export function InlineNoteEditor({ note, sessionId, onSaved, onDeleted }: InlineNoteEditorProps) {
  const entityType = note.entityType as 'customer' | 'device' | 'visit';

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<NoteHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const { draft, updateDraft, hasConflict, resolveKeepLocal, resolveUseServer } = useNoteDraft({
    entityType,
    entityId: note.entityId,
    sessionId,
    serverContent: note.content,
    onSave: async (content) => {
      const updated = await updateNote({ noteId: note.id, sessionId, content });
      onSaved(updated);
    },
  });

  const [hasChanges, setHasChanges] = useState(false);

  const { saveError, retry } = useAutoSave({
    saveFn: async () => {
      const updated = await updateNote({ noteId: note.id, sessionId, content: draft });
      onSaved(updated);
      setHasChanges(false);
    },
    hasChanges,
    debounceMs: 1500,
  });

  const handleChange = (content: string) => {
    updateDraft(content);
    setHasChanges(content !== note.content);
  };

  const handleHistoryToggle = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      setHistoryEntries([]);
      setHistoryError(null);
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await fetchNoteAudit(note.id);
      setHistoryEntries(result.entries);
    } catch {
      setHistoryError('Failed to load history');
      setHistoryOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleteError(null);
    try {
      await deleteNote({ noteId: note.id });
      onDeleted?.(note.id);
    } catch {
      setDeleteError('Delete failed');
      setConfirmingDelete(false);
    }
  };

  return (
    <div data-testid={`note-row-${note.id}`} style={{ marginBottom: '8px' }}>
      {onDeleted && confirmingDelete && (
        <div
          data-testid="delete-confirm-prompt"
          style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', fontSize: '13px', color: 'var(--error, #d32f2f)' }}
        >
          <span>Delete this note?</span>
          <button type="button" data-testid="delete-confirm-yes" onClick={handleDeleteConfirm}>Yes, delete</button>
          <button type="button" data-testid="delete-confirm-no" onClick={() => setConfirmingDelete(false)}>Cancel</button>
        </div>
      )}
      {deleteError && (
        <div
          data-testid="delete-error"
          style={{ marginBottom: '6px', fontSize: '13px', color: 'var(--error, #d32f2f)' }}
        >
          {deleteError}
        </div>
      )}
      {hasConflict && (
        <div
          data-testid="conflict-prompt"
          style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '13px', color: 'var(--warning, #f57c00)' }}
        >
          <span>Unsaved local draft differs from server</span>
          <button type="button" onClick={() => resolveKeepLocal()}>Keep local</button>
          <button type="button" onClick={resolveUseServer}>Use server</button>
        </div>
      )}
      {saveError && (
        <div
          data-testid="save-error"
          style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', fontSize: '13px', color: 'var(--error, #d32f2f)' }}
        >
          <AlertTriangle size={14} />
          <span>Save failed</span>
          <button
            type="button"
            onClick={retry}
            style={{ textDecoration: 'underline', cursor: 'pointer', border: 'none', background: 'none', color: 'inherit', padding: 0, font: 'inherit' }}
          >
            Retry
          </button>
        </div>
      )}
      <NoteEditor
        entityType={entityType}
        entityId={note.entityId}
        initialContent={draft}
        onChange={handleChange}
      />
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <button
          type="button"
          data-testid="history-toggle-btn"
          onClick={handleHistoryToggle}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-secondary)', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
          title={historyOpen ? 'Hide history' : 'Show history'}
        >
          <History size={12} />
        </button>
        {onDeleted && !confirmingDelete && (
          <button
            type="button"
            data-testid="delete-note-btn"
            onClick={() => setConfirmingDelete(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-secondary)', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
            title="Delete note"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {historyLoading && (
        <div data-testid="history-loading" style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '4px 0' }}>
          Loading history…
        </div>
      )}
      {historyError && (
        <div data-testid="history-error" style={{ fontSize: '12px', color: 'var(--error, #d32f2f)', padding: '4px 0' }}>
          {historyError}
        </div>
      )}
      {historyOpen && !historyLoading && !historyError && (
        <NoteHistory entries={historyEntries} />
      )}
    </div>
  );
}
