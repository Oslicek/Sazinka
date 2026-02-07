import { Link, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '@/stores/natsStore';
import { useActiveJobsStore } from '@/stores/activeJobsStore';
import { useAuthStore } from '@/stores/authStore';
import styles from './Layout.module.css';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isConnected = useNatsStore((s) => s.isConnected);
  const activeJobsCount = useActiveJobsStore((s) => s.activeCount);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const role = user?.role ?? 'worker';

  // Role-based navigation:
  // Admin: all pages
  // Customer: all except Admin
  // Worker: all except Admin and Settings
  const showAdmin = role === 'admin';
  const showSettings = role === 'admin' || role === 'customer';

  const handleLogout = () => {
    logout();
    navigate({ to: '/login' });
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <Link to="/">Sazinka</Link>
        </div>
        
        <nav className={styles.nav}>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/customers">Zákazníci</NavLink>
          <NavLink to="/calendar">Kalendář</NavLink>
          <NavLink to="/inbox">Fronta</NavLink>
          <NavLink to="/planner">Plán dne</NavLink>
          <NavLink to="/jobs">Úlohy</NavLink>
          {showSettings && <NavLink to="/settings">Nastavení</NavLink>}
          {showAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>

        <div className={styles.headerRight}>
          {activeJobsCount > 0 && (
            <Link to="/jobs" className={styles.activeJobs}>
              <span className={styles.activeJobsIndicator} />
              Aktivní úlohy: {activeJobsCount}
            </Link>
          )}
          
          <div className={styles.status}>
            <span
              className={styles.statusDot}
              style={{ backgroundColor: isConnected ? 'var(--color-success)' : 'var(--color-error)' }}
            />
            {isConnected ? 'Online' : 'Offline'}
          </div>

          {user && (
            <div className={styles.userMenu}>
              <span className={styles.userName}>{user.name}</span>
              <button className={styles.logoutButton} onClick={handleLogout}>
                Odhlásit
              </button>
            </div>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={styles.navLink}
      activeProps={{ className: styles.navLinkActive }}
    >
      {children}
    </Link>
  );
}
