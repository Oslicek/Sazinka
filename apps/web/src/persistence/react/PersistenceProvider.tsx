/**
 * PersistenceProvider — React context that wires the PersistenceOrchestrator
 * to the component tree.
 *
 * Pages wrap themselves in this provider (or use the app-level singleton).
 * Consumers use usePersistence(), usePersistentControl(), or usePersistentProfile().
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PersistenceOrchestrator } from '../core/PersistenceOrchestrator';
import type {
  PersistenceAdapter,
  PersistenceProfile,
  HydratedState,
  ChannelId,
} from '../core/types';

interface PersistenceContextValue {
  orchestrator: PersistenceOrchestrator;
  profiles: PersistenceProfile[];
  userId: string | null;
  getState(profileId: string): HydratedState;
  commit(profileId: string, controlId: string, value: unknown): void;
  reset(profileId: string): void;
}

const PersistenceContext = createContext<PersistenceContextValue | null>(null);

export function usePersistence(): PersistenceContextValue {
  const ctx = useContext(PersistenceContext);
  if (!ctx) throw new Error('usePersistence must be used inside PersistenceProvider');
  return ctx;
}

interface PersistenceProviderProps {
  userId: string | null;
  profiles: PersistenceProfile[];
  adapters: Partial<Record<ChannelId, PersistenceAdapter>>;
  children: React.ReactNode;
}

export function PersistenceProvider({
  userId,
  profiles,
  adapters,
  children,
}: PersistenceProviderProps) {
  const orchestrator = useMemo(
    () => new PersistenceOrchestrator({ adapters }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [states, setStates] = useState<Record<string, HydratedState>>(() => {
    const ctx = { userId };
    const initial: Record<string, HydratedState> = {};
    for (const profile of profiles) {
      initial[profile.profileId] = orchestrator.hydrateProfile(profile, ctx);
    }
    return initial;
  });

  // Re-hydrate when userId changes
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevUserIdRef.current === userId) return;
    prevUserIdRef.current = userId;

    const ctx = { userId };
    setStates(() => {
      const next: Record<string, HydratedState> = {};
      for (const profile of profiles) {
        next[profile.profileId] = orchestrator.hydrateProfile(profile, ctx);
      }
      return next;
    });
  }, [userId, orchestrator, profiles]);

  const getState = (profileId: string): HydratedState => states[profileId] ?? {};

  const commit = (profileId: string, controlId: string, value: unknown) => {
    const profile = profiles.find((p) => p.profileId === profileId);
    if (!profile) return;
    orchestrator.commit(profile, controlId, value, { userId });
    setStates((prev) => ({
      ...prev,
      [profileId]: { ...prev[profileId], [controlId]: value },
    }));
  };

  const reset = (profileId: string) => {
    const profile = profiles.find((p) => p.profileId === profileId);
    if (!profile) return;
    orchestrator.resetProfile(profile, { userId });
    const defaults: HydratedState = {};
    for (const control of profile.controls) {
      defaults[control.controlId] = control.defaultValue;
    }
    setStates((prev) => ({ ...prev, [profileId]: defaults }));
  };

  const value = useMemo(
    () => ({ orchestrator, profiles, userId, getState, commit, reset }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [states, userId],
  );

  return (
    <PersistenceContext.Provider value={value}>
      {children}
    </PersistenceContext.Provider>
  );
}
