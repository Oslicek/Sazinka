import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import {
  setLocalLayoutPreference,
  syncLayoutPreferenceToDb,
} from '@/services/layoutPreferenceService';
import styles from './LayoutManager.module.css';

export type LayoutMode = 'stack' | 'dual' | 'grid' | 'wide';

export interface LayoutManagerProps {
  mode: LayoutMode;
  onModeChange: (mode: LayoutMode) => void;
}

const TABLET_MODES: LayoutMode[] = ['dual', 'grid'];
const DESKTOP_MODES: LayoutMode[] = ['dual', 'grid', 'wide'];

const MODE_I18N_KEYS: Record<LayoutMode, string> = {
  stack: 'layout_stack',
  dual: 'layout_dual',
  grid: 'layout_grid',
  wide: 'layout_wide',
};

export function LayoutManager({ mode, onModeChange }: LayoutManagerProps) {
  const { breakpoint } = useBreakpoint();
  const { t } = useTranslation('planner');
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
          {t(MODE_I18N_KEYS[m], m)}
        </button>
      ))}
    </div>
  );
}
