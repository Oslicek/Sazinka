import { Navigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Required roles (legacy). If not specified, any authenticated user can access. */
  roles?: string[];
  /** Required permission key (e.g. "page:inbox"). Checked via RBAC for workers. */
  requiredPermission?: string;
}

/**
 * Protects routes by requiring authentication and optionally specific roles or permissions.
 * Redirects to /login if not authenticated.
 * Shows forbidden message if authenticated but lacks access.
 */
export function ProtectedRoute({ children, roles, requiredPermission }: ProtectedRouteProps) {
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

  // Check legacy role restriction (e.g. admin-only pages)
  if (roles && user && !roles.includes(user.role)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Pristup odepren</h2>
        <p>Nemate opravneni pro pristup k teto strance.</p>
      </div>
    );
  }

  // Check RBAC permission
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Pristup odepren</h2>
        <p>Nemate opravneni pro pristup k teto strance.</p>
      </div>
    );
  }

  return <>{children}</>;
}
