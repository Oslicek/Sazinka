import { Navigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Required roles. If not specified, any authenticated user can access. */
  roles?: string[];
}

/**
 * Protects routes by requiring authentication and optionally specific roles.
 * Redirects to /login if not authenticated.
 * Shows forbidden message if authenticated but wrong role.
 */
export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

  // Still verifying token - show nothing (prevents flash)
  if (isLoading) {
    return null;
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  // Check role if required
  if (roles && user && !roles.includes(user.role)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Přístup odepřen</h2>
        <p>Nemáte oprávnění pro přístup k této stránce.</p>
      </div>
    );
  }

  return <>{children}</>;
}
