/**
 * InlineNoteEditor — shared note row component used in Visit, Customer, and WorkItem pages.
 *
 * Encapsulates: useNoteDraft (draft + conflict) + useAutoSave (debounced save + error) + NoteEditor.
 * Keeps the three pages in sync: add delete/audit features here, they appear everywhere.
 */
import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Note } from '@shared/note';
import { NoteEditor } from './NoteEditor';
import { useNoteDraft } from '../../hooks/useNoteDraft';
import { useAutoSave } from '../../hooks/useAutoSave';
import { updateNote, deleteNote } from '../../services/noteService';

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
      {onDeleted && !confirmingDelete && (
        <button
          type="button"
          data-testid="delete-note-btn"
          onClick={() => setConfirmingDelete(true)}
          style={{ marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-secondary)', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
          title="Delete note"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
