import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import styles from './SplitLayout.module.css';

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitLayoutProps {
  /** First pane (left or top depending on direction) */
  left: ReactNode;
  /** Second pane (right or bottom depending on direction) */
  right: ReactNode;
  /** Split direction. Default: 'horizontal' */
  direction?: SplitDirection;
  /** Initial size of the first pane as a percentage. Default: 50 */
  leftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  resizable?: boolean;
  className?: string;
}

export function SplitLayout({
  left,
  right,
  direction = 'horizontal',
  leftWidth: initialLeftWidth = 50,
  minLeftWidth = 20,
  maxLeftWidth = 80,
  resizable = true,
  className,
}: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const leftWidthRef = useRef(leftWidth);
  const isVertical = direction === 'vertical';

  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);

  const startDrag = useCallback(
    (clientPos: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const containerSize = isVertical ? rect.height : rect.width;
      const startPos = clientPos;
      const startWidth = leftWidthRef.current;

      const onMove = (pos: number) => {
        const delta = ((pos - startPos) / containerSize) * 100;
        const clamped = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidth + delta));
        setLeftWidth(clamped);
      };

      const handleMouseMove = (ev: MouseEvent) => onMove(isVertical ? ev.clientY : ev.clientX);
      const handleTouchMove = (ev: TouchEvent) => onMove(isVertical ? ev.touches[0].clientY : ev.touches[0].clientX);

      const cleanup = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', cleanup);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', cleanup);
        document.removeEventListener('touchcancel', cleanup);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', cleanup);
      document.addEventListener('touchmove', handleTouchMove, { passive: true });
      document.addEventListener('touchend', cleanup);
      document.addEventListener('touchcancel', cleanup);
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [minLeftWidth, maxLeftWidth, isVertical]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startDrag(isVertical ? e.clientY : e.clientX);
    },
    [startDrag, isVertical]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      startDrag(isVertical ? e.touches[0].clientY : e.touches[0].clientX);
    },
    [startDrag, isVertical]
  );

  const containerClass = isVertical
    ? `${styles.container} ${styles.containerVertical} ${className ?? ''}`
    : `${styles.container} ${className ?? ''}`;

  const dividerClass = isVertical
    ? `${styles.divider} ${styles.dividerVertical}`
    : styles.divider;

  const sizeStyle = isVertical
    ? { height: `${leftWidth}%` }
    : { width: `${leftWidth}%` };

  return (
    <div ref={containerRef} className={containerClass}>
      <div className={isVertical ? styles.topPane : styles.leftPane} style={sizeStyle}>
        {left}
      </div>
      {resizable && (
        <div
          className={dividerClass}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        />
      )}
      <div className={isVertical ? styles.bottomPane : styles.rightPane}>
        {right}
      </div>
    </div>
  );
}
