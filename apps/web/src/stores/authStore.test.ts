import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';
import { useNatsStore } from './natsStore';

// Mock natsStore
vi.mock('./natsStore', () => ({
  useNatsStore: {
    getState: vi.fn(),
  },
}));

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageMock.store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageMock.store[key]; }),
  clear: vi.fn(() => { localStorageMock.store = {}; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('AuthStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  describe('login', () => {
    it('sets user and token on successful login', async () => {
      const mockUser = { id: '1', email: 'test@example.com', name: 'Test', role: 'customer' as const, locale: 'en' };
      const mockToken = 'header.payload.signature';
      const requestFn = vi.fn().mockResolvedValue({
        payload: { token: mockToken, user: mockUser },
      });

      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await useAuthStore.getState().login('test@example.com', 'password123');

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().token).toBe(mockToken);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('sazinka_token', mockToken);
    });

    it('sets error on failed login (invalid credentials)', async () => {
      const requestFn = vi.fn().mockResolvedValue({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await expect(useAuthStore.getState().login('test@example.com', 'wrong')).rejects.toThrow();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      // i18n.t() returns the key in test env (no auth namespace loaded)
      expect(useAuthStore.getState().error).toBe('auth:error_invalid_credentials');
    });

    it('sets error on rate limited login', async () => {
      const requestFn = vi.fn().mockResolvedValue({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts' },
      });
      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await expect(useAuthStore.getState().login('test@example.com', 'any')).rejects.toThrow();

      expect(useAuthStore.getState().error).toBe('auth:error_rate_limited');
    });
  });

  describe('register', () => {
    it('sets user and token on successful registration', async () => {
      const mockUser = { id: '2', email: 'new@example.com', name: 'New User', role: 'customer' as const, locale: 'en' };
      const mockToken = 'reg.token.here';
      const requestFn = vi.fn().mockResolvedValue({
        payload: { token: mockToken, user: mockUser },
      });
      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await useAuthStore.getState().register('new@example.com', 'password123', 'New User');

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('sets error on duplicate email', async () => {
      const requestFn = vi.fn().mockResolvedValue({
        error: { code: 'DUPLICATE_EMAIL', message: 'Email exists' },
      });
      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await expect(useAuthStore.getState().register('test@example.com', 'password', 'Test')).rejects.toThrow();

      expect(useAuthStore.getState().error).toBe('auth:error_duplicate_email');
    });
  });

  describe('logout', () => {
    it('clears auth state and removes token from localStorage', () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test', role: 'customer', locale: 'en' },
        token: 'some.token.here',
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('sazinka_token');
    });
  });

  describe('verify', () => {
    it('restores auth state from localStorage on valid token', async () => {
      const mockUser = { id: '1', email: 'test@example.com', name: 'Test', role: 'admin' as const, locale: 'en' };
      localStorageMock.store['sazinka_token'] = 'stored.jwt.token';

      const requestFn = vi.fn().mockResolvedValue({ payload: mockUser });
      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await useAuthStore.getState().verify();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().token).toBe('stored.jwt.token');
    });

    it('clears auth state on expired token', async () => {
      localStorageMock.store['sazinka_token'] = 'expired.token.here';

      const requestFn = vi.fn().mockResolvedValue({
        error: { code: 'INVALID_TOKEN', message: 'Token expired' },
      });
      (useNatsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ request: requestFn });

      await useAuthStore.getState().verify();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('sazinka_token');
    });

    it('does nothing when no token in localStorage', async () => {
      await useAuthStore.getState().verify();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('helpers', () => {
    it('getToken returns current token', () => {
      useAuthStore.setState({ token: 'my.token.value' });
      expect(useAuthStore.getState().getToken()).toBe('my.token.value');
    });

    it('getUserId returns user id', () => {
      useAuthStore.setState({
        user: { id: 'user-uuid', email: 'a@b.c', name: 'A', role: 'customer', locale: 'en' },
      });
      expect(useAuthStore.getState().getUserId()).toBe('user-uuid');
    });

    it('getUserId throws when not authenticated', () => {
      useAuthStore.setState({ user: null });
      expect(() => useAuthStore.getState().getUserId()).toThrow('common:not_authenticated');
    });

    it('getRole returns user role', () => {
      useAuthStore.setState({
        user: { id: '1', email: 'a@b.c', name: 'A', role: 'admin', locale: 'en' },
      });
      expect(useAuthStore.getState().getRole()).toBe('admin');
    });
  });
});
