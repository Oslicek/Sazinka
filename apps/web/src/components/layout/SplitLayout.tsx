import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import styles from './SplitLayout.module.css';

export interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
  leftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  resizable?: boolean;
  className?: string;
}

export function SplitLayout({
  left,
  right,
  leftWidth: initialLeftWidth = 50,
  minLeftWidth = 20,
  maxLeftWidth = 80,
  resizable = true,
  className,
}: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const leftWidthRef = useRef(leftWidth);

  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      e.preventDefault();

      const containerRect = containerRef.current.getBoundingClientRect();
      const startX = e.clientX;
      const startWidth = leftWidthRef.current;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = ((moveEvent.clientX - startX) / containerRect.width) * 100;
        const newWidth = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidth + delta));
        setLeftWidth(newWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [minLeftWidth, maxLeftWidth]
  );

  return (
    <div ref={containerRef} className={`${styles.container} ${className ?? ''}`}>
      <div className={styles.leftPane} style={{ width: `${leftWidth}%` }}>
        {left}
      </div>
      {resizable && (
        <div className={styles.divider} onMouseDown={handleDividerMouseDown} />
      )}
      <div className={styles.rightPane}>
        {right}
      </div>
    </div>
  );
}
