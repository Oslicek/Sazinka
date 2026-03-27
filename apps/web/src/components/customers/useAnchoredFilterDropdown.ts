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

    let measureCallCount = 0;
    function measure() {
      measureCallCount += 1;
      const el = anchorRefStable.current?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let left = r.left;
      const vw = window.innerWidth;
      if (left + MAX_PANEL_WIDTH > vw - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, vw - MAX_PANEL_WIDTH - VIEWPORT_MARGIN);
      }
      // #region agent log
      const msg = `[DBG] measure #${measureCallCount}: tag=${el.tagName} rectLeft=${r.left.toFixed(1)} rectBottom=${r.bottom.toFixed(1)} finalLeft=${left.toFixed(1)} top=${(r.bottom+GAP_PX).toFixed(1)}`;
      console.log(msg);
      fetch('http://127.0.0.1:7353/ingest/1d957424-b904-4bc5-af34-a37ca7963434',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ee0c72'},body:JSON.stringify({sessionId:'ee0c72',location:'useAnchoredFilterDropdown.ts:measure',message:msg,data:{callNum:measureCallCount,tag:el.tagName,rectLeft:r.left,rectBottom:r.bottom,finalLeft:left},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      setPos({ top: r.bottom + GAP_PX, left });
    }

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [usePortal, positionKey]);

  return { ...pos, usePortal };
}
