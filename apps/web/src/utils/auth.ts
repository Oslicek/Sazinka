import { useAuthStore } from '@/stores/authStore';

/**
 * Get the current JWT token for NATS requests.
 */
export function getToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Get the current user ID (for NATS subscriptions like job status).
 */
export function getUserId(): string {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/**
 * Check if the current user has one of the specified roles.
 */
export function hasRole(...roles: string[]): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  return roles.includes(user.role);
}
