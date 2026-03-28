import { useState, useCallback, useRef, useEffect } from 'react';
import type { NoteEntityType } from '@shared/note';

interface UseNoteDraftOptions {
  entityType: NoteEntityType;
  entityId: string;
  sessionId: string;
  serverContent: string;
  onSave?: (markdown: string) => Promise<void>;
}

interface UseNoteDraftReturn {
  draft: string;
  hasConflict: boolean;
  updateDraft: (content: string) => void;
  flushDraft: () => Promise<boolean>;
  resolveKeepLocal: () => Promise<void>;
  resolveUseServer: () => void;
}

function storageKey(entityType: string, entityId: string, sessionId: string): string {
  return `noteDraft:${entityType}:${entityId}:${sessionId}`;
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

export function useNoteDraft({
  entityType,
  entityId,
  sessionId,
  serverContent,
  onSave,
}: UseNoteDraftOptions): UseNoteDraftReturn {
  const key = storageKey(entityType, entityId, sessionId);
  const localDraft = readDraft(key);

  const [draft, setDraft] = useState<string>(localDraft ?? serverContent);
  const [conflictResolved, setConflictResolved] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // #5: Reset state when identity (entity/session) changes
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      const stored = readDraft(key);
      const next = stored ?? serverContent;
      setDraft(next);
      draftRef.current = next;
      setConflictResolved(false);
    }
  }, [key, serverContent]);

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
    try {
      if (onSave) {
        await onSave(draftRef.current);
      }
      setConflictResolved(true);
    } catch {
      // Save failed — leave conflict unresolved so the user can retry
    }
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
