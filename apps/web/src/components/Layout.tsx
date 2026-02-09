import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '@/stores/natsStore';
import { useActiveJobsStore } from '@/stores/activeJobsStore';
import { useAuthStore } from '@/stores/authStore';
import styles from './Layout.module.css';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isConnected = useNatsStore((s) => s.isConnected);
  const activeJobsCount = useActiveJobsStore((s) => s.activeCount);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const role = user?.role ?? 'worker';

  // Role-based navigation
  const showAdmin = role === 'admin';
  const showSettings = role === 'admin' || role === 'customer';

  const handleLogout = () => {
    logout();
    navigate({ to: '/login' });
  };

  const handleMenuItemClick = () => {
    setMenuOpen(false);
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button 
            className={styles.hamburger}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <span className={styles.hamburgerLine}></span>
            <span className={styles.hamburgerLine}></span>
            <span className={styles.hamburgerLine}></span>
          </button>
          
          <div className={styles.logo}>
            <Link to="/">Sazinka</Link>
          </div>
        </div>
        
        <nav className={styles.nav}>
          <NavLink to="/calendar">Kalendář</NavLink>
          <NavLink to="/inbox">Fronta</NavLink>
          <NavLink to="/planner">Plán dne</NavLink>
          <NavLink to="/routes">Trasy</NavLink>
          <NavLink to="/customers">Zákazníci</NavLink>
          <NavLink to="/worklog">Záznam</NavLink>
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

      {/* Hamburger Menu Overlay */}
      {menuOpen && (
        <>
          <div className={styles.menuOverlay} onClick={() => setMenuOpen(false)} />
          <nav className={styles.menuDrawer}>
            <div className={styles.menuHeader}>
              <span className={styles.menuTitle}>Menu</span>
              <button 
                className={styles.menuClose}
                onClick={() => setMenuOpen(false)}
                aria-label="Zavřít menu"
              >
                ×
              </button>
            </div>
            
            <div className={styles.menuItems}>
              <MenuLink to="/calendar" onClick={handleMenuItemClick}>Kalendář</MenuLink>
              <MenuLink to="/inbox" onClick={handleMenuItemClick}>Fronta</MenuLink>
              <MenuLink to="/planner" onClick={handleMenuItemClick}>Plán dne</MenuLink>
              <MenuLink to="/routes" onClick={handleMenuItemClick}>Trasy</MenuLink>
              <MenuLink to="/customers" onClick={handleMenuItemClick}>Zákazníci</MenuLink>
              <MenuLink to="/worklog" onClick={handleMenuItemClick}>Záznam</MenuLink>
              <MenuLink to="/jobs" onClick={handleMenuItemClick}>Úlohy</MenuLink>
              {showSettings && <MenuLink to="/settings" onClick={handleMenuItemClick}>Nastavení</MenuLink>}
              {showAdmin && <MenuLink to="/admin" onClick={handleMenuItemClick}>Admin</MenuLink>}
              
              <div className={styles.menuDivider} />
              
              <MenuLink to="/about" onClick={handleMenuItemClick}>O službě</MenuLink>
            </div>
          </nav>
        </>
      )}

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

function MenuLink({ to, onClick, children }: { to: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={styles.menuLink}
      activeProps={{ className: styles.menuLinkActive }}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
