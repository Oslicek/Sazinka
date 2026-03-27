import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

const GAP_PX = 4;
const MAX_PANEL_WIDTH = 320;
const VIEWPORT_MARGIN = 8;

/**
 * Positions a filter panel below an anchor (filter button) using fixed coordinates.
 * Used with createPortal(..., document.body) so the panel is not clipped by overflow:auto ancestors.
 *
 * Position is computed once on mount. Only window resize triggers a recalculation
 * (scroll events are ignored — internal dropdown scrolling must not shift the panel).
 */
export function useAnchoredFilterDropdown(
  anchorRef: RefObject<HTMLElement | null> | undefined,
  /** When the anchored target changes (e.g. another column), re-measure. */
  positionKey?: string | number,
): {
  top: number;
  left: number;
  usePortal: boolean;
} {
  const usePortal = Boolean(anchorRef);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRefStable = useRef(anchorRef);
  anchorRefStable.current = anchorRef;

  useLayoutEffect(() => {
    if (!usePortal) return;

    function measure() {
      const el = anchorRefStable.current?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let left = r.left;
      const vw = window.innerWidth;
      if (left + MAX_PANEL_WIDTH > vw - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, vw - MAX_PANEL_WIDTH - VIEWPORT_MARGIN);
      }
      setPos({ top: r.bottom + GAP_PX, left });
    }

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [usePortal, positionKey]);

  return { ...pos, usePortal };
}
