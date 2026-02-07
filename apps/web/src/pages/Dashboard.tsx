import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import type { CalendarItem } from '@shared/calendar';
import { useNatsStore } from '@/stores/natsStore';
import { getRevisionStats, type RevisionStats } from '../services/revisionService';
import { listCalendarItems } from '../services/calendarService';
import styles from './Dashboard.module.css';

function getStatusLabel(status: CalendarItem['status']): string {
  const labels: Record<CalendarItem['status'], string> = {
    scheduled: 'Naplánováno',
    overdue: 'Po termínu',
    in_progress: 'Probíhá',
    completed: 'Dokončeno',
    cancelled: 'Zrušeno',
    due: 'Termín',
    pending: 'Čeká',
  };
  return labels[status] || status;
}

function getItemLink(item: CalendarItem) {
  if (item.type === 'revision') {
    return { to: '/revisions/$revisionId' as const, params: { revisionId: item.id } };
  }
  if (item.customerId) {
    return { to: '/customers/$customerId' as const, params: { customerId: item.customerId } };
  }
  return null;
}

export function Dashboard() {
  const navigate = useNavigate();
  const isConnected = useNatsStore((s) => s.isConnected);
  const connectionError = useNatsStore((s) => s.error);
  
  const [stats, setStats] = useState<RevisionStats | null>(null);
  const [todayItems, setTodayItems] = useState<CalendarItem[]>([]);
  const [weekItems, setWeekItems] = useState<CalendarItem[]>([]);
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
      const today = new Date();
      const todayKey = today.toISOString().substring(0, 10);
      const weekAhead = new Date();
      weekAhead.setDate(today.getDate() + 7);
      const weekKey = weekAhead.toISOString().substring(0, 10);

      const [revisionStats, todayResponse, weekResponse] = await Promise.all([
        getRevisionStats(),
        listCalendarItems({
          startDate: todayKey,
          endDate: todayKey,
          viewMode: 'scheduled',
        }),
        listCalendarItems({
          startDate: todayKey,
          endDate: weekKey,
          viewMode: 'scheduled',
        }),
      ]);

      setStats(revisionStats);
      setTodayItems(todayResponse.items);
      setWeekItems(weekResponse.items);
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

  const sortedTodayItems = useMemo(() => {
    return [...todayItems].sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''));
  }, [todayItems]);

  const overdueItems = useMemo(() => weekItems.filter((item) => item.status === 'overdue'), [weekItems]);
  const unassignedItems = useMemo(
    () => weekItems.filter((item) => (item.type === 'visit' || item.type === 'revision') && !item.crewId),
    [weekItems]
  );
  const pendingFollowUps = useMemo(
    () => weekItems.filter((item) => item.type === 'task' && (item.status === 'pending' || item.status === 'overdue')),
    [weekItems]
  );

  const plannedThisWeek = useMemo(
    () => weekItems.filter((item) => item.status === 'scheduled' || item.status === 'in_progress').length,
    [weekItems]
  );

  const completedThisWeek = useMemo(
    () => weekItems.filter((item) => item.status === 'completed').length,
    [weekItems]
  );

  const completionRate = useMemo(() => {
    if (plannedThisWeek === 0) return 0;
    return Math.round((completedThisWeek / plannedThisWeek) * 100);
  }, [plannedThisWeek, completedThisWeek]);

  const uniqueCustomers = useMemo(() => {
    const ids = new Set(weekItems.map((item) => item.customerId).filter(Boolean));
    return ids.size;
  }, [weekItems]);

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
        <div className={`card ${styles.statCard}`}>
          <h3>Plán tento týden</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : plannedThisWeek}
          </p>
          <p className={styles.subtitle}>naplánováno</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>Dokončeno tento týden</h3>
          <p className={`${styles.bigNumber} ${styles.successNumber}`}>
            {isLoading ? '-' : completedThisWeek}
          </p>
          <p className={styles.subtitle}>položek</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>Úspěšnost týdne</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : `${completionRate}%`}
          </p>
          <p className={styles.subtitle}>dokončeno z plánovaných</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>Zákazníků v týdnu</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : uniqueCustomers}
          </p>
          <p className={styles.subtitle}>unikátních</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>Bez posádky</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : unassignedItems.length}
          </p>
          <p className={styles.subtitle}>v příštích 7 dnech</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>Follow-up</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : pendingFollowUps.length}
          </p>
          <p className={styles.subtitle}>čeká na kontakt</p>
        </div>
      </div>

      {statsError && (
        <div className={styles.error} style={{ marginTop: '1rem' }}>
          {statsError}
        </div>
      )}

      <div className={styles.sectionGrid}>
        <div className={`card ${styles.sectionCard}`}>
          <div className={styles.sectionHeader}>
            <h3>Dnešní plán</h3>
            <Link
              to="/calendar"
              search={{ view: 'scheduled', layout: 'agenda', types: 'revision,visit,task' }}
              className={styles.sectionLink}
            >
              Otevřít v kalendáři
            </Link>
          </div>
          {sortedTodayItems.length === 0 ? (
            <p className={styles.emptyState}>Žádné položky na dnes.</p>
          ) : (
            <div className={styles.worklist}>
              {sortedTodayItems.slice(0, 6).map((item) => {
                const link = getItemLink(item);
                const content = (
                  <>
                    <span className={styles.workStatus}>{getStatusLabel(item.status)}</span>
                    <span className={styles.workTime}>{item.timeStart || '--:--'}</span>
                    <span className={styles.workTitle}>{item.customerName || item.title}</span>
                    <span className={styles.workSubtitle}>{item.subtitle || item.sourceType}</span>
                  </>
                );
                return link ? (
                  <Link
                    key={`${item.type}-${item.id}`}
                    to={link.to}
                    params={link.params}
                    className={`${styles.workItem} ${styles.workItemLink}`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={`${item.type}-${item.id}`} className={styles.workItem}>
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`card ${styles.sectionCard}`}>
          <div className={styles.sectionHeader}>
            <h3>Rizika v příštích 7 dnech</h3>
            <Link
              to="/calendar"
              search={{ view: 'due', layout: 'agenda', status: 'overdue', types: 'revision,visit,task' }}
              className={styles.sectionLink}
            >
              Zobrazit po termínu
            </Link>
          </div>
          <div className={styles.worklist}>
            <div className={styles.workItem}>
              <span className={styles.workStatus}>Po termínu</span>
              <span className={styles.workTitle}>{overdueItems.length} položek</span>
              <span className={styles.workSubtitle}>Potřebuje řešit</span>
            </div>
            <div className={styles.workItem}>
              <span className={styles.workStatus}>Bez posádky</span>
              <span className={styles.workTitle}>{unassignedItems.length} položek</span>
              <span className={styles.workSubtitle}>Doplnit posádku</span>
            </div>
            <div className={styles.workItem}>
              <span className={styles.workStatus}>Follow-up</span>
              <span className={styles.workTitle}>{pendingFollowUps.length} položek</span>
              <span className={styles.workSubtitle}>Čeká na kontakt</span>
            </div>
          </div>
        </div>
      </div>

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
