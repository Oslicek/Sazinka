import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { CalendarItem } from '@shared/calendar';
import { useNatsStore } from '@/stores/natsStore';
import { getRevisionStats, type RevisionStats } from '../services/revisionService';
import { listCalendarItems } from '../services/calendarService';
import { Phone } from 'lucide-react';
import styles from './Dashboard.module.css';

function getStatusLabel(status: CalendarItem['status'], t: (key: string) => string): string {
  const keyMap: Record<CalendarItem['status'], string> = {
    scheduled: 'calendar:status_scheduled',
    overdue: 'calendar:status_overdue',
    in_progress: 'calendar:status_in_progress',
    completed: 'calendar:status_completed',
    cancelled: 'calendar:status_cancelled',
    due: 'calendar:status_due',
    pending: 'calendar:status_pending',
  };
  return t(keyMap[status] || status);
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
  const { t } = useTranslation('dashboard');
  
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
      setStatsError(err instanceof Error ? err.message : t('error_load_stats'));
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
      <h1>{t('title')}</h1>

      {/* Call Queue CTA - prominent banner */}
      {totalToCall > 0 && (
        <Link to="/queue" className={styles.callQueueBanner}>
          <div className={styles.bannerContent}>
            <Phone size={16} className={styles.bannerIcon} />
            <div className={styles.bannerText}>
              <strong>{t('call_queue_count', { count: totalToCall })}</strong>
              <span>{t('call_queue_start')}</span>
            </div>
          </div>
          <span className={styles.bannerArrow}>→</span>
        </Link>
      )}
      
      <div className={styles.grid}>
        <div className="card">
          <h3>{t('connection_title')}</h3>
          <p>
            Status: {isConnected ? t('status_connected') : t('status_disconnected')}
          </p>
          {connectionError && <p className={styles.error}>{connectionError}</p>}
        </div>

        {/* Clickable stat - Today's revisions -> Planner */}
        <Link 
          to="/planner" 
          className={`card ${styles.statCard} ${styles.clickableStat} ${(stats?.scheduledToday ?? 0) > 0 ? styles.statActive : ''}`}
        >
          <h3>{t('today_revisions')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : (stats?.scheduledToday ?? 0)}
          </p>
          <p className={styles.subtitle}>{t('scheduled')}</p>
        </Link>

        {/* Clickable stat - This week -> Queue */}
        <Link 
          to="/queue" 
          search={{ filter: 'thisWeek' }}
          className={`card ${styles.statCard} ${styles.clickableStat} ${(stats?.dueThisWeek ?? 0) > 0 ? styles.statWarning : ''}`}
        >
          <h3>{t('this_week')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : (stats?.dueThisWeek ?? 0)}
          </p>
          <p className={styles.subtitle}>{t('to_call')}</p>
        </Link>

        {/* Clickable stat - Overdue -> Queue with filter */}
        <Link 
          to="/queue" 
          search={{ filter: 'overdue' }}
          className={`card ${styles.statCard} ${styles.clickableStat} ${(stats?.overdue ?? 0) > 0 ? styles.statDanger : ''}`}
        >
          <h3>{t('overdue')}</h3>
          <p className={`${styles.bigNumber} ${(stats?.overdue ?? 0) > 0 ? styles.dangerNumber : ''}`}>
            {isLoading ? '-' : (stats?.overdue ?? 0)}
          </p>
          <p className={styles.subtitle}>{t('revisions')}</p>
        </Link>
      </div>

      <div className={styles.grid} style={{ marginTop: '1rem' }}>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('completed_month')}</h3>
          <p className={`${styles.bigNumber} ${styles.successNumber}`}>
            {isLoading ? '-' : (stats?.completedThisMonth ?? 0)}
          </p>
          <p className={styles.subtitle}>{t('revisions_unit')}</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('plan_this_week')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : plannedThisWeek}
          </p>
          <p className={styles.subtitle}>{t('planned')}</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('completed_week')}</h3>
          <p className={`${styles.bigNumber} ${styles.successNumber}`}>
            {isLoading ? '-' : completedThisWeek}
          </p>
          <p className={styles.subtitle}>{t('items')}</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('success_rate')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : `${completionRate}%`}
          </p>
          <p className={styles.subtitle}>{t('completion_desc')}</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('customers_week')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : uniqueCustomers}
          </p>
          <p className={styles.subtitle}>{t('unique')}</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('no_crew')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : unassignedItems.length}
          </p>
          <p className={styles.subtitle}>{t('next_7_days')}</p>
        </div>
        <div className={`card ${styles.statCard}`}>
          <h3>{t('follow_up')}</h3>
          <p className={styles.bigNumber}>
            {isLoading ? '-' : pendingFollowUps.length}
          </p>
          <p className={styles.subtitle}>{t('waiting_contact')}</p>
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
            <h3>{t('today_plan')}</h3>
            <Link
              to="/calendar"
              search={{ view: 'scheduled', layout: 'agenda', types: 'revision,visit,task' }}
              className={styles.sectionLink}
            >
              {t('open_in_calendar')}
            </Link>
          </div>
          {sortedTodayItems.length === 0 ? (
            <p className={styles.emptyState}>{t('no_items_today')}</p>
          ) : (
            <div className={styles.worklist}>
              {sortedTodayItems.slice(0, 6).map((item) => {
                const link = getItemLink(item);
                const content = (
                  <>
                    <span className={styles.workStatus}>{getStatusLabel(item.status, t)}</span>
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
            <h3>{t('risks_7_days')}</h3>
            <Link
              to="/calendar"
              search={{ view: 'due', layout: 'agenda', status: 'overdue', types: 'revision,visit,task' }}
              className={styles.sectionLink}
            >
              {t('show_overdue')}
            </Link>
          </div>
          <div className={styles.worklist}>
            <div className={styles.workItem}>
              <span className={styles.workStatus}>{t('overdue_label')}</span>
              <span className={styles.workTitle}>{t('items_count', { count: overdueItems.length })}</span>
              <span className={styles.workSubtitle}>{t('needs_attention')}</span>
            </div>
            <div className={styles.workItem}>
              <span className={styles.workStatus}>{t('no_crew_label')}</span>
              <span className={styles.workTitle}>{t('items_count', { count: unassignedItems.length })}</span>
              <span className={styles.workSubtitle}>{t('assign_crew')}</span>
            </div>
            <div className={styles.workItem}>
              <span className={styles.workStatus}>{t('follow_up_label')}</span>
              <span className={styles.workTitle}>{t('items_count', { count: pendingFollowUps.length })}</span>
              <span className={styles.workSubtitle}>{t('waiting_for_contact')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>{t('quick_actions')}</h3>
        <div className={styles.actions}>
          <button 
            className="btn-primary"
            onClick={() => navigate({ to: '/queue' })}
          >
            {t('start_calling')}
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate({ to: '/today' })}
          >
            {t('my_day')}
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate({ to: '/planner' })}
          >
            {t('plan')}
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate({ to: '/customers', search: { action: 'new' } })}
          >
            {t('new_customer')}
          </button>
        </div>
      </div>
    </div>
  );
}
