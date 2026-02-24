import { Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Required roles (legacy). If not specified, any authenticated user can access. */
  roles?: string[];
  /** Required permission key (e.g. "page:inbox"). Checked via RBAC for workers. */
  requiredPermission?: string;
}

/**
 * Protects routes by requiring authentication, email verification, and completed onboarding.
 * Redirects to /login if not authenticated.
 * Redirects to /register (wizard) if email is unverified or onboarding is incomplete.
 * Shows forbidden message if authenticated but lacks access.
 */
export function ProtectedRoute({ children, roles, requiredPermission }: ProtectedRouteProps) {
  const { t } = useTranslation('nav');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  // Still verifying token - show nothing (prevents flash)
  if (isLoading) {
    return null;
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  // Email not verified - back to wizard Step 1
  if (user && !user.emailVerified) {
    return <Navigate to="/register" />;
  }

  // Onboarding incomplete - redirect to wizard to resume
  if (user && !user.onboardingCompletedAt) {
    return <Navigate to="/register" />;
  }

  // Check legacy role restriction (e.g. admin-only pages)
  if (roles && user && !roles.includes(user.role)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>{t('access_denied')}</h2>
        <p>{t('access_denied_message')}</p>
      </div>
    );
  }

  // Check RBAC permission
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>{t('access_denied')}</h2>
        <p>{t('access_denied_message')}</p>
      </div>
    );
  }

  return <>{children}</>;
}
