import { type ReactNode, useState, useCallback, useRef } from 'react';
import styles from './SplitView.module.css';

type PanelConfig = {
  id: string;
  minWidth?: number;
  defaultWidth?: number;
  maxWidth?: number;
  content: ReactNode;
};

interface SplitViewProps {
  panels: PanelConfig[];
  /** Direction of the split: horizontal (side by side) or vertical (stacked) */
  direction?: 'horizontal' | 'vertical';
  /** Allow resizing panels */
  resizable?: boolean;
  /** Class name for the container */
  className?: string;
}

export function SplitView({
  panels,
  direction = 'horizontal',
  resizable = true,
  className,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidths, setPanelWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    for (const panel of panels) {
      widths[panel.id] = panel.defaultWidth ?? 100 / panels.length;
    }
    return widths;
  });

  const handleResizeStart = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      if (!resizable || !containerRef.current) return;

      e.preventDefault();
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const isHorizontal = direction === 'horizontal';
      const containerSize = isHorizontal ? containerRect.width : containerRect.height;

      const leftPanel = panels[index];
      const rightPanel = panels[index + 1];

      const startPos = isHorizontal ? e.clientX : e.clientY;
      const startLeftWidth = panelWidths[leftPanel.id];
      const startRightWidth = panelWidths[rightPanel.id];

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const delta = ((currentPos - startPos) / containerSize) * 100;

        let newLeftWidth = startLeftWidth + delta;
        let newRightWidth = startRightWidth - delta;

        // Apply min/max constraints
        const leftMin = leftPanel.minWidth ?? 10;
        const leftMax = leftPanel.maxWidth ?? 80;
        const rightMin = rightPanel.minWidth ?? 10;
        const rightMax = rightPanel.maxWidth ?? 80;

        if (newLeftWidth < leftMin) {
          newLeftWidth = leftMin;
          newRightWidth = startLeftWidth + startRightWidth - leftMin;
        }
        if (newLeftWidth > leftMax) {
          newLeftWidth = leftMax;
          newRightWidth = startLeftWidth + startRightWidth - leftMax;
        }
        if (newRightWidth < rightMin) {
          newRightWidth = rightMin;
          newLeftWidth = startLeftWidth + startRightWidth - rightMin;
        }
        if (newRightWidth > rightMax) {
          newRightWidth = rightMax;
          newLeftWidth = startLeftWidth + startRightWidth - rightMax;
        }

        setPanelWidths((prev) => ({
          ...prev,
          [leftPanel.id]: newLeftWidth,
          [rightPanel.id]: newRightWidth,
        }));
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction, panels, panelWidths, resizable]
  );

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${styles[direction]} ${className ?? ''}`}
    >
      {panels.map((panel, index) => (
        <div key={panel.id} className={styles.panelWrapper}>
          <div
            className={styles.panel}
            style={{
              [direction === 'horizontal' ? 'width' : 'height']:
                `${panelWidths[panel.id]}%`,
            }}
          >
            {panel.content}
          </div>
          {resizable && index < panels.length - 1 && (
            <div
              className={styles.resizer}
              onMouseDown={handleResizeStart(index)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Simplified 3-panel layout for Planning Inbox
interface ThreePanelLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  leftWidth?: number;
  centerWidth?: number;
  rightWidth?: number;
  className?: string;
}

export function ThreePanelLayout({
  left,
  center,
  right,
  leftWidth = 25,
  centerWidth = 45,
  rightWidth = 30,
  className,
}: ThreePanelLayoutProps) {
  return (
    <SplitView
      className={className}
      panels={[
        { id: 'left', content: left, defaultWidth: leftWidth, minWidth: 15, maxWidth: 40 },
        { id: 'center', content: center, defaultWidth: centerWidth, minWidth: 30, maxWidth: 60 },
        { id: 'right', content: right, defaultWidth: rightWidth, minWidth: 20, maxWidth: 45 },
      ]}
    />
  );
}
