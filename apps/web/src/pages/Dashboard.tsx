import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useNatsStore } from '@/stores/natsStore';
import { getRevisionStats, type RevisionStats } from '../services/revisionService';
import styles from './Dashboard.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export function Dashboard() {
  const navigate = useNavigate();
  const isConnected = useNatsStore((s) => s.isConnected);
  const connectionError = useNatsStore((s) => s.error);
  
  const [stats, setStats] = useState<RevisionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!isConnected) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setStatsError(null);
      const data = await getRevisionStats(TEMP_USER_ID);
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
      setStatsError(err instanceof Error ? err.message : 'Nepodařilo se načíst statistiky');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Refresh stats every 30 seconds when connected
  useEffect(() => {
    if (!isConnected) return;
    
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [isConnected, loadStats]);

  // Calculate total to call
  const totalToCall = (stats?.overdue ?? 0) + (stats?.dueThisWeek ?? 0);

  return (
    <div className={styles.dashboard}>
      <h1>Dashboard</h1>

      {/* Call Queue CTA - prominent banner */}
      {totalToCall > 0 && (
        <Link to="/queue" className={styles.callQueueBanner}>
          <div className={styles.bannerContent}>
            <span className={styles.bannerIcon}>📞</span>
            <div className={styles.bannerText}>
              <strong>{totalToCall} zákazníků k obvolání</strong>
              <span>Začít obvolávat</span>
            </div>
          </div>
          <span className={styles.bannerArrow}>→</span>
        </Link>
      )}
      
      <div className={styles.grid}>
        <div className="card">
          <h3>Připojení</h3>
          <p>
            Status: {isConnected ? '✅ Připojeno' : '❌ Odpojeno'}
          </p>
          {connectionError && <p className={styles.error}>{connectionError}</p>}
        </div>

        {/* Clickable stat - Today's revisions -> Planner */}
        <Link 
          to="/planner" 
          className={`card ${styles.statCard} ${styles.clickableStat} ${(stats?.scheduledToday ?? 0) > 0 ? styles.statActive : ''}`}
        >
          <h3>Dnešní revize</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : (stats?.scheduledToday ?? 0)}
          </p>
          <p className={styles.subtitle}>naplánováno →</p>
        </Link>

        {/* Clickable stat - This week -> Queue */}
        <Link 
          to="/queue" 
          search={{ filter: 'thisWeek' }}
          className={`card ${styles.statCard} ${styles.clickableStat} ${(stats?.dueThisWeek ?? 0) > 0 ? styles.statWarning : ''}`}
        >
          <h3>Tento týden</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : (stats?.dueThisWeek ?? 0)}
          </p>
          <p className={styles.subtitle}>k obvolání →</p>
        </Link>

        {/* Clickable stat - Overdue -> Queue with filter */}
        <Link 
          to="/queue" 
          search={{ filter: 'overdue' }}
          className={`card ${styles.statCard} ${styles.clickableStat} ${(stats?.overdue ?? 0) > 0 ? styles.statDanger : ''}`}
        >
          <h3>Po termínu</h3>
          <p className={`${styles.bigNumber} ${(stats?.overdue ?? 0) > 0 ? styles.dangerNumber : ''}`}>
            {isLoading ? '-' : (stats?.overdue ?? 0)}
          </p>
          <p className={styles.subtitle}>revizí →</p>
        </Link>
      </div>

      <div className={styles.grid} style={{ marginTop: '1rem' }}>
        <div className={`card ${styles.statCard}`}>
          <h3>Dokončeno tento měsíc</h3>
          <p className={`${styles.bigNumber} ${styles.successNumber}`}>
            {isLoading ? '-' : (stats?.completedThisMonth ?? 0)}
          </p>
          <p className={styles.subtitle}>revizí</p>
        </div>
      </div>

      {statsError && (
        <div className={styles.error} style={{ marginTop: '1rem' }}>
          {statsError}
        </div>
      )}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Rychlé akce</h3>
        <div className={styles.actions}>
          <button 
            className="btn-primary"
            onClick={() => navigate({ to: '/queue' })}
          >
            📞 Začít obvolávat
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate({ to: '/today' })}
          >
            📋 Můj den
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate({ to: '/planner' })}
          >
            🗓️ Naplánovat
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate({ to: '/customers', search: { action: 'new' } })}
          >
            + Nový zákazník
          </button>
        </div>
      </div>
    </div>
  );
}
