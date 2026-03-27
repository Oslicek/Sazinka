import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

const GAP_PX = 4;
const MAX_PANEL_WIDTH = 320;
const VIEWPORT_MARGIN = 8;

/**
 * Positions a filter panel below an anchor (filter button) using fixed coordinates.
 * Used with createPortal(..., document.body) so the panel is not clipped by overflow:auto ancestors.
 */
export function useAnchoredFilterDropdown(anchorRef: RefObject<HTMLElement | null> | undefined): {
  top: number;
  left: number;
  usePortal: boolean;
} {
  const usePortal = Boolean(anchorRef);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (!anchorRef?.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    let left = r.left;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (left + MAX_PANEL_WIDTH > vw - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, vw - MAX_PANEL_WIDTH - VIEWPORT_MARGIN);
    }
    setPos({ top: r.bottom + GAP_PX, left });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!usePortal) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [usePortal, updatePosition]);

  return { ...pos, usePortal };
}
