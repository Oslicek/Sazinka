import { useState, useRef, useEffect, useCallback } from 'react';

const DEFAULT_FEATURES = 'width=900,height=700,menubar=no,toolbar=no';

export function usePanelWindow(windowName: string): {
  isDetached: boolean;
  detach(url: string, features?: string): void;
  reattach(): void;
} {
  const [isDetached, setIsDetached] = useState(false);
  const winRef = useRef<Window | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const detach = useCallback(
    (url: string, features?: string) => {
      const win = window.open(url, windowName, features ?? DEFAULT_FEATURES);
      if (!win) {
        console.warn(`usePanelWindow: popup blocked for "${windowName}"`);
        return;
      }

      winRef.current = win;
      setIsDetached(true);
      clearPoll();

      intervalRef.current = setInterval(() => {
        if (winRef.current?.closed) {
          winRef.current = null;
          setIsDetached(false);
          clearPoll();
        }
      }, 1000);
    },
    [windowName, clearPoll],
  );

  const reattach = useCallback(() => {
    clearPoll();
    winRef.current?.close();
    winRef.current = null;
    setIsDetached(false);
  }, [clearPoll]);

  useEffect(() => {
    return () => {
      clearPoll();
    };
  }, [clearPoll]);

  return { isDetached, detach, reattach };
}
