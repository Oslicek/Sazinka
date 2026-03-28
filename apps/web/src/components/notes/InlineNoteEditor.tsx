/**
 * InlineNoteEditor — shared note row component used in Visit, Customer, and WorkItem pages.
 *
 * Encapsulates: useNoteDraft (draft + conflict) + useAutoSave (debounced save + error) + NoteEditor.
 * Keeps the three pages in sync: add delete/audit features here, they appear everywhere.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Note } from '@shared/note';
import { NoteEditor } from './NoteEditor';
import { useNoteDraft } from '../../hooks/useNoteDraft';
import { useAutoSave } from '../../hooks/useAutoSave';
import { updateNote } from '../../services/noteService';

export interface InlineNoteEditorProps {
  note: Note;
  sessionId: string;
  onSaved: (updated: Note) => void;
}

export function InlineNoteEditor({ note, sessionId, onSaved }: InlineNoteEditorProps) {
  const entityType = note.entityType as 'customer' | 'device' | 'visit';

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

  return (
    <div data-testid={`note-row-${note.id}`} style={{ marginBottom: '8px' }}>
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
    </div>
  );
}
