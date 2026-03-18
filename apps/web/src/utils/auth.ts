import { useAuthStore } from '@/stores/authStore';

/**
 * Get the current JWT token for NATS requests.
 */
export function getToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  return token;
}
