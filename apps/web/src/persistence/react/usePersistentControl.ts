/**
 * usePersistentControl — hook for a single persisted control.
 *
 * Optionally debounces writes (for text search inputs).
 * Flushes pending debounced write on unmount.
 */
import { useCallback, useEffect, useRef } from 'react';
import { usePersistence } from './PersistenceProvider';

export function usePersistentControl<T = unknown>(
  profileId: string,
  controlId: string,
  debounceMs?: number,
): {
  value: T;
  setValue: (value: T) => void;
} {
  const { getState, commit } = usePersistence();
  const state = getState(profileId);
  const value = state[controlId] as T;

  const pendingRef = useRef<{ value: T; timer: ReturnType<typeof setTimeout> } | null>(null);

  const setValue = useCallback(
    (newValue: T) => {
      if (debounceMs && debounceMs > 0) {
        if (pendingRef.current) clearTimeout(pendingRef.current.timer);
        const timer = setTimeout(() => {
          pendingRef.current = null;
          commit(profileId, controlId, newValue);
        }, debounceMs);
        pendingRef.current = { value: newValue, timer };
        // Debounced: do NOT commit immediately — wait for timer to settle
      } else {
        commit(profileId, controlId, newValue);
      }
    },
    [profileId, controlId, debounceMs, commit],
  );

  // Flush pending debounced write on unmount
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        commit(profileId, controlId, pendingRef.current.value);
        pendingRef.current = null;
      }
    };
  }, [profileId, controlId, commit]);

  return { value, setValue };
}
