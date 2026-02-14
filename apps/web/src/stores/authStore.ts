import { create } from 'zustand';
import type { UserPublic, AuthResponse } from '@shared/auth';
import { createRequest } from '@shared/messages';
import { useNatsStore } from './natsStore';
import i18n from '@/i18n';

const TOKEN_KEY = 'sazinka_token';

interface AuthState {
  user: UserPublic | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, businessName?: string, locale?: string) => Promise<void>;
  logout: () => void;
  verify: () => Promise<void>;
  refreshToken: () => Promise<void>;
  getToken: () => string | null;
  getUserId: () => string;
  getRole: () => string;

  // Permission helpers
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (keys: string[]) => boolean;
}

type NatsResponse<T> = { payload: T } | { error: { code: string; message: string } };

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { request } = useNatsStore.getState();
      const req = createRequest(undefined, { email, password });
      const response = await request<typeof req, NatsResponse<AuthResponse>>(
        'sazinka.auth.login',
        req,
        10000,
      );

      if ('error' in response) {
        const msg = response.error.code === 'RATE_LIMITED'
          ? i18n.t('auth:error_rate_limited')
          : response.error.code === 'INVALID_CREDENTIALS'
            ? i18n.t('auth:error_invalid_credentials')
            : response.error.message;
        set({ isLoading: false, error: msg });
        throw new Error(msg);
      }

      const { token, user } = response.payload;
      localStorage.setItem(TOKEN_KEY, token);
      set({ user, token, isAuthenticated: true, isLoading: false, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : i18n.t('auth:error_login');
      set({ isLoading: false, error: msg });
      throw e;
    }
  },

  register: async (email: string, password: string, name: string, businessName?: string, locale?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { request } = useNatsStore.getState();
      const req = createRequest(undefined, { email, password, name, businessName, locale: locale ?? 'en' });
      const response = await request<typeof req, NatsResponse<AuthResponse>>(
        'sazinka.auth.register',
        req,
        10000,
      );

      if ('error' in response) {
        const msg = response.error.code === 'DUPLICATE_EMAIL'
          ? i18n.t('auth:error_duplicate_email')
          : response.error.code === 'VALIDATION_ERROR'
            ? response.error.message
            : response.error.message;
        set({ isLoading: false, error: msg });
        throw new Error(msg);
      }

      const { token, user } = response.payload;
      localStorage.setItem(TOKEN_KEY, token);
      set({ user, token, isAuthenticated: true, isLoading: false, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : i18n.t('auth:error_register');
      set({ isLoading: false, error: msg });
      throw e;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null, isAuthenticated: false, isLoading: false, error: null });
  },

  verify: async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const { request } = useNatsStore.getState();
      const req = createRequest(undefined, { token: storedToken });
      const response = await request<typeof req, NatsResponse<UserPublic>>(
        'sazinka.auth.verify',
        req,
        5000,
      );

      if ('error' in response) {
        // Token invalid or expired
        localStorage.removeItem(TOKEN_KEY);
        set({ isLoading: false, isAuthenticated: false, token: null, user: null });
        return;
      }

      set({
        user: response.payload,
        token: storedToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      // Network error or NATS not connected yet - keep token, try again later
      // Don't remove token on network errors (user might just be loading)
      set({ isLoading: false });
    }
  },

  refreshToken: async () => {
    const currentToken = get().token;
    if (!currentToken) return;

    try {
      const { request } = useNatsStore.getState();
      const req = createRequest(undefined, { token: currentToken });
      const response = await request<typeof req, NatsResponse<AuthResponse>>(
        'sazinka.auth.refresh',
        req,
        5000,
      );

      if ('error' in response) {
        // Token invalid — force re-login
        localStorage.removeItem(TOKEN_KEY);
        set({ isAuthenticated: false, token: null, user: null });
        return;
      }

      const { token, user } = response.payload;
      localStorage.setItem(TOKEN_KEY, token);
      set({ user, token, isAuthenticated: true });
    } catch {
      // Network error — don't logout, just skip refresh
    }
  },

  getToken: () => get().token,

  getUserId: () => {
    const user = get().user;
    if (!user) throw new Error(i18n.t('common:not_authenticated'));
    return user.id;
  },

  getRole: () => {
    const user = get().user;
    if (!user) throw new Error(i18n.t('common:not_authenticated'));
    return user.role;
  },

  hasPermission: (key: string) => {
    const user = get().user;
    if (!user) return false;
    // admin and customer have full access
    if (user.role === 'admin' || user.role === 'customer') return true;
    const perms = user.permissions ?? [];
    return perms.includes('*') || perms.includes(key);
  },

  hasAnyPermission: (keys: string[]) => {
    const user = get().user;
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'customer') return true;
    const perms = user.permissions ?? [];
    if (perms.includes('*')) return true;
    return keys.some((k) => perms.includes(k));
  },
}));
