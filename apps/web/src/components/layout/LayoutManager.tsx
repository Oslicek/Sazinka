import { useRef } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import {
  setLocalLayoutPreference,
  syncLayoutPreferenceToDb,
} from '@/services/layoutPreferenceService';

export type LayoutMode = 'stack' | 'split' | 'tiles' | 'classic';

export interface LayoutManagerProps {
  mode: LayoutMode;
  onModeChange: (mode: LayoutMode) => void;
}

const TABLET_MODES: LayoutMode[] = ['split', 'tiles'];
const DESKTOP_MODES: LayoutMode[] = ['split', 'tiles', 'classic'];

const MODE_LABELS: Record<LayoutMode, string> = {
  stack: 'Stack',
  split: 'Split',
  tiles: 'Tiles',
  classic: 'Classic',
};

export function LayoutManager({ mode, onModeChange }: LayoutManagerProps) {
  const { breakpoint } = useBreakpoint();
  const dbSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (breakpoint === 'phone') return null;

  const buttons = breakpoint === 'tablet' ? TABLET_MODES : DESKTOP_MODES;

  const handleClick = (newMode: LayoutMode) => {
    setLocalLayoutPreference({ mode: newMode, updatedAt: Date.now() });

    if (dbSyncTimer.current !== null) clearTimeout(dbSyncTimer.current);
    dbSyncTimer.current = setTimeout(() => {
      void syncLayoutPreferenceToDb({ mode: newMode, updatedAt: Date.now() });
    }, 5000);

    onModeChange(newMode);
  };

  return (
    <div role="toolbar" aria-label="Layout mode">
      {buttons.map((m) => (
        <button
          key={m}
          aria-pressed={mode === m}
          onClick={() => handleClick(m)}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
