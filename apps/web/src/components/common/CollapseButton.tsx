import styles from './CollapseButton.module.css';

interface CollapseButtonProps {
  collapsed: boolean;
  onClick: () => void;
  title?: string;
  /** Use 'overlay' for buttons floating on top of content (e.g. map) */
  variant?: 'default' | 'overlay';
  className?: string;
}

/**
 * Reusable collapse/expand toggle button with animated chevron.
 *
 * - Default: transparent circle, chevron rotates on collapse
 * - Overlay: bordered square with shadow, for floating on maps etc.
 */
export function CollapseButton({
  collapsed,
  onClick,
  title,
  variant = 'default',
  className,
}: CollapseButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.collapseButton} ${variant === 'overlay' ? styles.overlay : ''} ${className ?? ''}`}
      data-collapsed={collapsed}
      onClick={onClick}
      title={title ?? (collapsed ? 'Rozbalit' : 'Sbalit')}
      aria-expanded={!collapsed}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  );
}
