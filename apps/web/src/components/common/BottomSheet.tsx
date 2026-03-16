import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import styles from './BottomSheet.module.css';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Initial snap point height as a fraction of dvh. Default: 0.7 */
  initialSnap?: number;
}

const SNAP_HALF = 0.7;
const SNAP_FULL = 0.92;
const DISMISS_THRESHOLD = 0.25; // fraction of sheet height to trigger dismiss

export function BottomSheet({ isOpen, onClose, title, children, initialSnap = SNAP_HALF }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; startH: number; isDragging: boolean } | null>(null);
  const currentSnapRef = useRef<number>(initialSnap);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [isOpen]);

  // Reset snap when sheet opens
  useEffect(() => {
    if (isOpen) {
      currentSnapRef.current = initialSnap;
      applySnap(initialSnap, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  function applySnap(snap: number, animate: boolean) {
    const el = sheetRef.current;
    if (!el) return;
    const vh = window.innerHeight;
    const h = Math.round(vh * snap);
    el.style.transition = animate ? 'height 0.25s ease-out, transform 0.25s ease-out' : 'none';
    el.style.height = `${h}px`;
    el.style.transform = 'translateY(0)';
  }

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only start drag from handle/header, or if content is scrolled to top
    const content = contentRef.current;
    const isAtTop = !content || content.scrollTop === 0;
    const isHandle = (e.target as HTMLElement).closest('[data-drag-handle]') !== null;
    if (!isHandle && !isAtTop) return;

    dragState.current = {
      startY: e.touches[0].clientY,
      startH: sheetRef.current?.offsetHeight ?? 0,
      isDragging: true,
    };
    const el = sheetRef.current;
    if (el) el.style.transition = 'none';
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState.current?.isDragging) return;
    const delta = e.touches[0].clientY - dragState.current.startY;
    if (delta < 0) {
      // Dragging up — allow snap to full
      const el = sheetRef.current;
      if (el) {
        const vh = window.innerHeight;
        const maxH = Math.round(vh * SNAP_FULL);
        const newH = Math.min(dragState.current.startH - delta, maxH);
        el.style.height = `${newH}px`;
      }
    } else {
      // Dragging down — translate downward
      const el = sheetRef.current;
      if (el) el.style.transform = `translateY(${delta}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!dragState.current?.isDragging) return;
    const delta = e.changedTouches[0].clientY - dragState.current.startY;
    dragState.current = null;

    const vh = window.innerHeight;
    const sheetH = sheetRef.current?.offsetHeight ?? 0;

    if (delta > sheetH * DISMISS_THRESHOLD) {
      // Dismiss
      const el = sheetRef.current;
      if (el) {
        el.style.transition = 'transform 0.25s ease-out';
        el.style.transform = `translateY(100%)`;
        setTimeout(onClose, 250);
      }
      return;
    }

    if (delta < -50) {
      // Snapped up toward full
      currentSnapRef.current = SNAP_FULL;
      applySnap(SNAP_FULL, true);
    } else if (delta > 30 && currentSnapRef.current === SNAP_FULL) {
      // Snapped down toward half
      currentSnapRef.current = SNAP_HALF;
      applySnap(SNAP_HALF, true);
    } else {
      // Snap back to current
      applySnap(currentSnapRef.current, true);
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} aria-modal="true" role="dialog">
      {/* Backdrop */}
      <div className={styles.backdrop} onClick={onClose} />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={styles.sheet}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className={styles.handle} data-drag-handle>
          <div className={styles.handleBar} />
        </div>

        {/* Header */}
        {title && (
          <div className={styles.header}>
            <div className={styles.title}>{title}</div>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}

        {/* Scrollable content */}
        <div ref={contentRef} className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
