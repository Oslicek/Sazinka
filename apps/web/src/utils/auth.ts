import { useAuthStore } from '@/stores/authStore';

/**
 * Get the current JWT token for NATS requests.
 * Falls back to legacy TEMP_USER_ID if not authenticated (dev mode).
 */
export function getToken(): string {
  const token = useAuthStore.getState().token;
  if (token) return token;
  // Legacy fallback for dev mode (before login is implemented everywhere)
  return '00000000-0000-0000-0000-000000000001';
}

/**
 * Get the current user ID (for NATS subscriptions like job status).
 */
export function getUserId(): string {
  const user = useAuthStore.getState().user;
  if (user) return user.id;
  // Legacy fallback
  return '00000000-0000-0000-0000-000000000001';
}

/**
 * Check if the current user has one of the specified roles.
 */
export function hasRole(...roles: string[]): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  return roles.includes(user.role);
}
