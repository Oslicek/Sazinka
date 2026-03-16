import { useRef } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import {
  setLocalLayoutPreference,
  syncLayoutPreferenceToDb,
} from '@/services/layoutPreferenceService';
import styles from './LayoutManager.module.css';

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
    <div role="toolbar" aria-label="Layout mode" className={styles.toolbar}>
      {buttons.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => handleClick(m)}
          className={`${styles.button} ${mode === m ? styles.buttonActive : ''}`}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
