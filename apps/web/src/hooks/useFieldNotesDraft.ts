import { useState, useCallback, useRef } from 'react';

interface UseFieldNotesDraftOptions {
  visitId: string;
  sessionId: string;
  serverContent: string;
  onSave?: (markdown: string) => Promise<void>;
}

interface UseFieldNotesDraftReturn {
  draft: string;
  hasConflict: boolean;
  updateDraft: (content: string) => void;
  flushDraft: () => Promise<boolean>;
  resolveKeepLocal: () => Promise<void>;
  resolveUseServer: () => void;
}

function storageKey(visitId: string, sessionId: string): string {
  return `fieldNotes:${visitId}:${sessionId}`;
}

function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDraft(key: string, content: string): void {
  try {
    localStorage.setItem(key, content);
  } catch {
    // quota exceeded — silently ignore
  }
}

function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // silently ignore
  }
}

export function useFieldNotesDraft({
  visitId,
  sessionId,
  serverContent,
  onSave,
}: UseFieldNotesDraftOptions): UseFieldNotesDraftReturn {
  const key = storageKey(visitId, sessionId);
  const localDraft = readDraft(key);

  const [draft, setDraft] = useState<string>(localDraft ?? serverContent);
  const [conflictResolved, setConflictResolved] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const hasConflict =
    !conflictResolved &&
    localDraft !== null &&
    localDraft !== serverContent &&
    serverContent !== '';

  const updateDraft = useCallback(
    (content: string) => {
      setDraft(content);
      draftRef.current = content;
      writeDraft(key, content);
    },
    [key],
  );

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (!onSave) return true;
    try {
      await onSave(draftRef.current);
      removeDraft(key);
      return true;
    } catch {
      return false;
    }
  }, [key, onSave]);

  const resolveKeepLocal = useCallback(async () => {
    if (onSave) {
      await onSave(draftRef.current);
    }
    setConflictResolved(true);
  }, [onSave]);

  const resolveUseServer = useCallback(() => {
    setDraft(serverContent);
    draftRef.current = serverContent;
    removeDraft(key);
    setConflictResolved(true);
  }, [key, serverContent]);

  return {
    draft,
    hasConflict,
    updateDraft,
    flushDraft,
    resolveKeepLocal,
    resolveUseServer,
  };
}
