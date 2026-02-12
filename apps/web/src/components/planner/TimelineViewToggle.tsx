/**
 * TimelineViewToggle — switch between compact and planning timeline views.
 */

import styles from './TimelineViewToggle.module.css';

export type TimelineView = 'compact' | 'planning';

interface TimelineViewToggleProps {
  value: TimelineView;
  onChange: (view: TimelineView) => void;
}

export function TimelineViewToggle({ value, onChange }: TimelineViewToggleProps) {
  return (
    <div className={styles.container}>
      <button
        type="button"
        className={`${styles.button} ${value === 'compact' ? styles.active : ''}`}
        onClick={() => onChange('compact')}
        title="Kompaktní pohled"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="12" height="2" rx="0.5" fill="currentColor" />
          <rect x="1" y="6" width="12" height="2" rx="0.5" fill="currentColor" />
          <rect x="1" y="11" width="12" height="2" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.button} ${value === 'planning' ? styles.active : ''}`}
        onClick={() => onChange('planning')}
        title="Plánovací pohled"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="12" height="4" rx="0.5" fill="currentColor" />
          <rect x="1" y="7" width="12" height="1.5" rx="0.5" fill="currentColor" opacity="0.4" />
          <rect x="1" y="10" width="12" height="3" rx="0.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
