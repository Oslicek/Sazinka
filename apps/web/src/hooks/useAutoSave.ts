import { useState, useEffect, useCallback, useRef } from 'react';

interface UseAutoSaveOptions {
  /** Async function to persist changes */
  saveFn: () => Promise<void>;
  /** Whether there are unsaved changes */
  hasChanges: boolean;
  /** Debounce delay in milliseconds (default: 1500) */
  debounceMs?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
}

interface UseAutoSaveReturn {
  /** Whether a save is currently in progress */
  isSaving: boolean;
  /** Timestamp of last successful save */
  lastSaved: Date | null;
  /** Error message from last failed save, or null */
  saveError: string | null;
  /** Manually trigger an immediate save (e.g. retry after error) */
  retry: () => void;
}

export function useAutoSave({
  saveFn,
  hasChanges,
  debounceMs = 1500,
  enabled = true,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep a ref to saveFn so the effect doesn't re-trigger on every render
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  // Track whether a save is in-flight to prevent double saves
  const isSavingRef = useRef(false);

  const doSave = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      await saveFnRef.current();
      setLastSaved(new Date());
      setSaveError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setIsSaving(false);
      isSavingRef.current = false;
    }
  }, []);

  // Debounced auto-save effect
  useEffect(() => {
    if (!hasChanges || !enabled) return;

    const timer = setTimeout(() => {
      doSave();
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [hasChanges, enabled, debounceMs, doSave]);

  // Retry: immediate save
  const retry = useCallback(() => {
    doSave();
  }, [doSave]);

  return { isSaving, lastSaved, saveError, retry };
}
