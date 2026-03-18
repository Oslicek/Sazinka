import { type ReactNode, useState, useCallback, useRef, useEffect } from 'react';
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
  // Keep a ref to panelWidths so resize handlers always see the latest value
  const panelWidthsRef = useRef(panelWidths);
  useEffect(() => {
    panelWidthsRef.current = panelWidths;
  }, [panelWidths]);

  /** Shared resize calculation — used by both mouse and touch handlers. */
  function calcResize(
    leftPanel: PanelConfig,
    rightPanel: PanelConfig,
    startLeftWidth: number,
    startRightWidth: number,
    startPos: number,
    currentPos: number,
    containerSize: number
  ): { newLeftWidth: number; newRightWidth: number } {
    const delta = ((currentPos - startPos) / containerSize) * 100;
    let newLeftWidth = startLeftWidth + delta;
    let newRightWidth = startRightWidth - delta;

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

    return { newLeftWidth, newRightWidth };
  }

  // #region agent log
  useEffect(() => {
    if (!containerRef.current) return;
    const c = containerRef.current;
    const cRect = c.getBoundingClientRect();
    const resizers = c.querySelectorAll(':scope > [data-dbg-resizer]');
    const panelEls = c.querySelectorAll(':scope > [data-dbg-panel]');
    const ids = panels.map(p=>p.id).join(',');
    for (const r of Array.from(resizers)) {
      const rect = (r as HTMLElement).getBoundingClientRect();
      const cs = window.getComputedStyle(r as HTMLElement);
      console.log(`[DBG-2ba648] resizer in ${direction} [${ids}]: w=${rect.width} h=${rect.height} pointer=${cs.pointerEvents} cursor=${cs.cursor} display=${cs.display} zIndex=${cs.zIndex}`);
    }
    for (const p of Array.from(panelEls)) {
      const rect = (p as HTMLElement).getBoundingClientRect();
      console.log(`[DBG-2ba648] panel ${(p as HTMLElement).dataset.dbgPanel} in ${direction} [${ids}]: w=${rect.width} h=${rect.height}`);
    }
    console.log(`[DBG-2ba648] container ${direction} [${ids}]: w=${cRect.width} h=${cRect.height} children=${c.children.length}`);
  }, [direction, panels.length]);
  // #endregion

  const handleResizeStart = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      if (!resizable || !containerRef.current) return;

      e.preventDefault();
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const isHorizontal = direction === 'horizontal';
      const containerSize = isHorizontal ? containerRect.width : containerRect.height;
      const startPos = isHorizontal ? e.clientX : e.clientY;

      const leftPanel = panels[index];
      const rightPanel = panels[index + 1];
      const startLeftWidth = panelWidthsRef.current[leftPanel.id];
      const startRightWidth = panelWidthsRef.current[rightPanel.id];

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const { newLeftWidth, newRightWidth } = calcResize(
          leftPanel, rightPanel, startLeftWidth, startRightWidth, startPos, currentPos, containerSize
        );
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
    [direction, panels, resizable]
  );

  const handleTouchStart = useCallback(
    (index: number) => (e: React.TouchEvent) => {
      if (!resizable || !containerRef.current) return;

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const isHorizontal = direction === 'horizontal';
      const containerSize = isHorizontal ? containerRect.width : containerRect.height;
      const startPos = isHorizontal ? e.touches[0].clientX : e.touches[0].clientY;

      const leftPanel = panels[index];
      const rightPanel = panels[index + 1];
      const startLeftWidth = panelWidthsRef.current[leftPanel.id];
      const startRightWidth = panelWidthsRef.current[rightPanel.id];

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.touches.length === 0) return;
        const currentPos = isHorizontal ? moveEvent.touches[0].clientX : moveEvent.touches[0].clientY;
        const { newLeftWidth, newRightWidth } = calcResize(
          leftPanel, rightPanel, startLeftWidth, startRightWidth, startPos, currentPos, containerSize
        );
        setPanelWidths((prev) => ({
          ...prev,
          [leftPanel.id]: newLeftWidth,
          [rightPanel.id]: newRightWidth,
        }));
      };

      const handleTouchEnd = () => {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove, { passive: true });
      document.addEventListener('touchend', handleTouchEnd);
    },
    [direction, panels, resizable]
  );

  const elements: React.ReactNode[] = [];
  for (let i = 0; i < panels.length; i++) {
    elements.push(
      <div
        key={panels[i].id}
        data-dbg-panel={panels[i].id}
        className={styles.panel}
        style={{
          [direction === 'horizontal' ? 'width' : 'height']:
            `${panelWidths[panels[i].id]}%`,
        }}
      >
        {panels[i].content}
      </div>
    );
    if (resizable && i < panels.length - 1) {
      elements.push(
        <div
          key={`resizer-${i}`}
          data-dbg-resizer={i}
          className={styles.resizer}
          onMouseDown={handleResizeStart(i)}
          onTouchStart={handleTouchStart(i)}
        />
      );
    }
  }

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${styles[direction]} ${className ?? ''}`}
    >
      {elements}
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
