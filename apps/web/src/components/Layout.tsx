import { Link } from '@tanstack/react-router';
import { useNatsStore } from '@/stores/natsStore';
import styles from './Layout.module.css';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isConnected = useNatsStore((s) => s.isConnected);

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
          <NavLink to="/queue">Fronta</NavLink>
          <NavLink to="/inbox">Inbox</NavLink>
          <NavLink to="/planner">Plán dne</NavLink>
          <NavLink to="/jobs">Úlohy</NavLink>
          <NavLink to="/settings">Nastavení</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>

        <div className={styles.status}>
          <span
            className={styles.statusDot}
            style={{ backgroundColor: isConnected ? 'var(--color-success)' : 'var(--color-error)' }}
          />
          {isConnected ? 'Online' : 'Offline'}
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
