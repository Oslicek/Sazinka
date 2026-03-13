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

  /** Returns true on success, false on failure */
  const doSave = useCallback(async (): Promise<boolean> => {
    if (isSavingRef.current) return false;
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      await saveFnRef.current();
      setLastSaved(new Date());
      setSaveError(null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // #region agent log
      console.log('[DEBUG-6ec9b9] doSave FAILED', { error: message });
      fetch('http://127.0.0.1:7353/ingest/1d957424-b904-4bc5-af34-a37ca7963434',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ec9b9'},body:JSON.stringify({sessionId:'6ec9b9',location:'useAutoSave.ts:doSave-catch',message:'doSave FAILED',data:{error:message},timestamp:Date.now(),hypothesisId:'H-B'})}).catch(()=>{});
      // #endregion
      setSaveError(message);
      return false;
    } finally {
      setIsSaving(false);
      isSavingRef.current = false;
    }
  }, []);

  // Auto-retry counter — bumped after each failed save so the effect re-fires
  const [retryAttempt, setRetryAttempt] = useState(0);

  // Reset retry counter when changes are cleared (new change cycle)
  const prevHasChanges = useRef(hasChanges);
  if (!hasChanges && prevHasChanges.current) {
    // hasChanges went from true → false: reset retry
    if (retryAttempt > 0) setRetryAttempt(0);
  }
  prevHasChanges.current = hasChanges;

  // Debounced auto-save effect
  useEffect(() => {
    // #region agent log
    console.log('[DEBUG-6ec9b9] useAutoSave effect', { hasChanges, enabled });
    fetch('http://127.0.0.1:7353/ingest/1d957424-b904-4bc5-af34-a37ca7963434',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ec9b9'},body:JSON.stringify({sessionId:'6ec9b9',location:'useAutoSave.ts:effect',message:'useAutoSave effect',data:{hasChanges,enabled},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{});
    // #endregion
    if (!hasChanges || !enabled) return;

    // After a failure, use exponential backoff: 3s, 6s, 12s, max 30s
    const delay = retryAttempt > 0
      ? Math.min(3000 * Math.pow(2, retryAttempt - 1), 30000)
      : debounceMs;

    const timer = setTimeout(async () => {
      const success = await doSave();
      if (success) {
        if (retryAttempt > 0) setRetryAttempt(0);
      } else {
        // Bump retry counter so this effect re-fires with longer delay
        setRetryAttempt((prev) => prev + 1);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [hasChanges, enabled, debounceMs, doSave, retryAttempt]);

  // Flush pending changes when the page is about to unload or hidden
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const flush = () => {
      if (hasChangesRef.current && enabledRef.current && !isSavingRef.current) {
        doSave();
      }
    };
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('beforeunload', flush);
    };
  }, [doSave]);

  // Manual retry: immediate save
  const retry = useCallback(() => {
    setRetryAttempt(0);
    doSave();
  }, [doSave]);

  return { isSaving, lastSaved, saveError, retry };
}
