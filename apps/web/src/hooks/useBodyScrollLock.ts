import { useEffect, useRef } from 'react';

/**
 * Locks body scroll when `locked` is true.
 *
 * iOS Safari requires `position: fixed` + `top: -scrollY` to prevent
 * the page from scrolling behind an overlay. On unlock, the original
 * scroll position is restored.
 *
 * Usage:
 *   useBodyScrollLock(isDrawerOpen);
 */
export function useBodyScrollLock(locked: boolean): void {
  const scrollYRef = useRef(0);

  useEffect(() => {
    if (!locked) return;

    // Capture current scroll position before locking
    scrollYRef.current = window.scrollY;

    const body = document.body;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.top = `-${scrollYRef.current}px`;

    return () => {
      body.style.overflow = '';
      body.style.position = '';
      body.style.width = '';
      body.style.top = '';
      // Restore scroll position
      window.scrollTo(0, scrollYRef.current);
    };
  }, [locked]);
}
