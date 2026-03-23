/**
 * usePersistentProfile — hook for a full profile (all controls at once).
 *
 * Provides the hydrated state object and commit/reset helpers.
 */
import { useCallback } from 'react';
import { usePersistence } from './PersistenceProvider';
import type { HydratedState } from '../core/types';

export function usePersistentProfile(profileId: string): {
  state: HydratedState;
  commit: (controlId: string, value: unknown) => void;
  reset: () => void;
} {
  const { getState, commit: ctxCommit, reset: ctxReset } = usePersistence();

  const state = getState(profileId);

  const commit = useCallback(
    (controlId: string, value: unknown) => ctxCommit(profileId, controlId, value),
    [profileId, ctxCommit],
  );

  const reset = useCallback(
    () => ctxReset(profileId),
    [profileId, ctxReset],
  );

  return { state, commit, reset };
}
