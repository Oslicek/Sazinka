import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useActiveJobsStore } from '@/stores/activeJobsStore';
import { useAuthStore } from '@/stores/authStore';
import styles from './Layout.module.css';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { t } = useTranslation('nav');
  const [menuOpen, setMenuOpen] = useState(false);
  const isConnected = useNatsStore((s) => s.isConnected);
  const activeJobsCount = useActiveJobsStore((s) => s.activeCount);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();

  const role = user?.role ?? 'worker';

  // Role-based navigation
  const showAdmin = role === 'admin';
  const showSettings = hasPermission('page:settings');

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
            aria-label={t('menu')}
          >
            <span className={styles.hamburgerLine}></span>
            <span className={styles.hamburgerLine}></span>
            <span className={styles.hamburgerLine}></span>
          </button>
          
          <div className={styles.logo}>
            <Link to="/">Ariadline</Link>
          </div>
        </div>
        
        <nav className={styles.nav}>
          {hasPermission('page:calendar') && <NavLink to="/calendar">{t('calendar')}</NavLink>}
          {hasPermission('page:inbox') && <NavLink to="/inbox">{t('inbox')}</NavLink>}
          {hasPermission('page:planner') && <NavLink to="/planner">{t('planner')}</NavLink>}
          {hasPermission('page:worklog') && <NavLink to="/worklog">{t('worklog')}</NavLink>}
          {hasPermission('page:customers') && <NavLink to="/customers">{t('customers')}</NavLink>}
          {hasPermission('page:routes') && <NavLink to="/routes">{t('routes')}</NavLink>}
          {hasPermission('page:jobs') && <NavLink to="/jobs">{t('jobs')}</NavLink>}
          {showSettings && <NavLink to="/settings">{t('settings')}</NavLink>}
          {showAdmin && <NavLink to="/admin">{t('admin')}</NavLink>}
        </nav>

        <div className={styles.headerRight}>
          {activeJobsCount > 0 && (
            <Link to="/jobs" className={styles.activeJobs}>
              <span className={styles.activeJobsIndicator} />
              {t('active_jobs', { count: activeJobsCount })}
            </Link>
          )}
          
          <div className={styles.status}>
            <span
              className={styles.statusDot}
              style={{ backgroundColor: isConnected ? 'var(--color-success)' : 'var(--color-error)' }}
            />
            {isConnected ? t('online') : t('offline')}
          </div>

          {user && (
            <div className={styles.userMenu}>
              <span className={styles.userName}>{user.name}</span>
              <button className={styles.logoutButton} onClick={handleLogout}>
                {t('logout')}
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
              <span className={styles.menuTitle}>{t('menu')}</span>
              <button 
                className={styles.menuClose}
                onClick={() => setMenuOpen(false)}
                aria-label={t('close_menu')}
              >
                ×
              </button>
            </div>
            
            <div className={styles.menuItems}>
              {hasPermission('page:calendar') && <MenuLink to="/calendar" onClick={handleMenuItemClick}>{t('calendar')}</MenuLink>}
              {hasPermission('page:inbox') && <MenuLink to="/inbox" onClick={handleMenuItemClick}>{t('inbox')}</MenuLink>}
              {hasPermission('page:planner') && <MenuLink to="/planner" onClick={handleMenuItemClick}>{t('planner')}</MenuLink>}
              {hasPermission('page:worklog') && <MenuLink to="/worklog" onClick={handleMenuItemClick}>{t('worklog')}</MenuLink>}
              {hasPermission('page:customers') && <MenuLink to="/customers" onClick={handleMenuItemClick}>{t('customers')}</MenuLink>}
              {hasPermission('page:routes') && <MenuLink to="/routes" onClick={handleMenuItemClick}>{t('routes')}</MenuLink>}
              {hasPermission('page:jobs') && <MenuLink to="/jobs" onClick={handleMenuItemClick}>{t('jobs')}</MenuLink>}
              {showSettings && <MenuLink to="/settings" onClick={handleMenuItemClick}>{t('settings')}</MenuLink>}
              {showAdmin && <MenuLink to="/admin" onClick={handleMenuItemClick}>{t('admin')}</MenuLink>}
              
              <div className={styles.menuDivider} />
              
              {hasPermission('page:about') && <MenuLink to="/about" onClick={handleMenuItemClick}>{t('about')}</MenuLink>}
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
