import { useState, useRef } from 'react';
import { useBreakpoint, type Breakpoint } from '@/hooks/useBreakpoint';
import {
  getLocalLayoutPreference,
  setLocalLayoutPreference,
  syncLayoutPreferenceToDb,
} from '@/services/layoutPreferenceService';
import type { LayoutMode } from '@/components/layout/LayoutManager';

function defaultModeForBreakpoint(bp: Breakpoint): LayoutMode {
  if (bp === 'phone') return 'stack';
  if (bp === 'tablet') return 'dual';
  return 'wide';
}

export function useLayoutMode(): { mode: LayoutMode; setMode: (m: LayoutMode) => void } {
  const { breakpoint } = useBreakpoint();
  const dbSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setModeState] = useState<LayoutMode>(() => {
    const pref = getLocalLayoutPreference();
    return pref?.mode ?? defaultModeForBreakpoint(breakpoint);
  });

  const setMode = (newMode: LayoutMode) => {
    setModeState(newMode);
    setLocalLayoutPreference({ mode: newMode, updatedAt: Date.now() });

    if (dbSyncTimer.current !== null) clearTimeout(dbSyncTimer.current);
    dbSyncTimer.current = setTimeout(() => {
      void syncLayoutPreferenceToDb({ mode: newMode, updatedAt: Date.now() });
    }, 5000);
  };

  return { mode, setMode };
}
