import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Periodically refreshes the JWT token before it expires.
 * The backend issues tokens with 8-hour lifetime; this hook
 * refreshes every 6 hours so the user never loses their session
 * while actively using the app.
 */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function useTokenRefresh() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Start periodic refresh
    timerRef.current = setInterval(() => {
      refreshToken();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isAuthenticated, refreshToken]);
}
