import { useState, useEffect } from 'react';

// ── Canonical breakpoint values (single source of truth for JS) ───────────────
// CSS equivalent lives in index.css (see "Canonical breakpoints" comment block).
export const BP_PHONE_MAX = 639;   // max-width: 639px  → phone
export const BP_TABLET_MAX = 1023; // max-width: 1023px → tablet (mobile UX)
const BP_DESKTOP_MIN = 1024; // min-width: 1024px → desktop

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export interface BreakpointState {
  /** Current named breakpoint tier */
  breakpoint: Breakpoint;
  /** True only on phones (≤ 639px) */
  isPhone: boolean;
  /** True on phones and tablets (≤ 1023px) — use for mobile UX decisions */
  isMobileUi: boolean;
  /** True on phones and tablets — alias for isMobileUi, signals touch-primary device */
  isTouch: boolean;
}

function getBreakpoint(width: number): Breakpoint {
  if (width <= BP_PHONE_MAX) return 'phone';
  if (width <= BP_TABLET_MAX) return 'tablet';
  return 'desktop';
}

function buildState(breakpoint: Breakpoint): BreakpointState {
  return {
    breakpoint,
    isPhone: breakpoint === 'phone',
    isMobileUi: breakpoint !== 'desktop',
    isTouch: breakpoint !== 'desktop',
  };
}

/** SSR-safe default — assumes desktop until hydration */
function getInitialState(): BreakpointState {
  if (typeof window === 'undefined') return buildState('desktop');
  return buildState(getBreakpoint(window.innerWidth));
}

/**
 * Returns the current breakpoint tier and convenience flags.
 * Updates reactively on window resize.
 */
export function useBreakpoint(): BreakpointState {
  const [state, setState] = useState<BreakpointState>(getInitialState);

  useEffect(() => {
    const phoneQuery = window.matchMedia(`(max-width: ${BP_PHONE_MAX}px)`);
    const tabletQuery = window.matchMedia(`(max-width: ${BP_TABLET_MAX}px)`);

    function update() {
      const bp = getBreakpoint(window.innerWidth);
      setState(buildState(bp));
    }

    phoneQuery.addEventListener('change', update);
    tabletQuery.addEventListener('change', update);

    // Sync once in case the initial render was SSR-defaulted to desktop
    update();

    return () => {
      phoneQuery.removeEventListener('change', update);
      tabletQuery.removeEventListener('change', update);
    };
  }, []);

  return state;
}
