import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import type { Revision } from '@shared/revision';
import type { CalendarDay } from '../utils/calendarUtils';
import { getMonthRange } from '../utils/calendarUtils';
import { listRevisions } from '../services/revisionService';
import { useNatsStore } from '../stores/natsStore';
import { CalendarGrid } from '../components/calendar';
import styles from './Calendar.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

const MONTH_NAMES = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
];

type ViewMode = 'due' | 'scheduled';

export function Calendar() {
  const navigate = useNavigate();
  const isConnected = useNatsStore((s) => s.isConnected);

  // View mode: show by due_date or scheduled_date
  const [viewMode, setViewMode] = useState<ViewMode>('due');

  // Current displayed month
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  
  // Data state
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Selected day state (for modal/details)
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [selectedRevisions, setSelectedRevisions] = useState<Revision[]>([]);

  // Load revisions for the current month
  const loadRevisions = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { start, end } = getMonthRange(year, month);
      
      const response = await listRevisions(TEMP_USER_ID, {
        fromDate: start,
        toDate: end,
        dateType: viewMode,
        limit: 500, // Should be enough for a month
      });

      setRevisions(response.items);
    } catch (err) {
      console.error('Failed to load revisions:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst revize');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, year, month, viewMode]);

  // Load revisions when month changes
  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  // Navigation handlers
  const goToPreviousMonth = useCallback(() => {
    if (month === 0) {
      setYear(y => y - 1);
      setMonth(11);
    } else {
      setMonth(m => m - 1);
    }
  }, [month]);

  const goToNextMonth = useCallback(() => {
    if (month === 11) {
      setYear(y => y + 1);
      setMonth(0);
    } else {
      setMonth(m => m + 1);
    }
  }, [month]);

  const goToToday = useCallback(() => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }, []);

  // Handle day click - show details or navigate to planner
  const handleDayClick = useCallback((day: CalendarDay, dayRevisions: Revision[]) => {
    setSelectedDay(day);
    setSelectedRevisions(dayRevisions);
  }, []);

  // Navigate to planner for selected date
  const handlePlanDay = useCallback(() => {
    if (selectedDay) {
      navigate({ to: '/planner', search: { date: selectedDay.dateKey } });
    }
  }, [navigate, selectedDay]);

  // Close detail panel
  const handleCloseDetails = useCallback(() => {
    setSelectedDay(null);
    setSelectedRevisions([]);
  }, []);

  // Stats for the month
  const monthStats = useMemo(() => {
    const scheduled = revisions.filter(r => r.status === 'scheduled' || r.status === 'confirmed').length;
    const now = new Date();
    const overdue = revisions.filter(r => {
      if (r.status === 'completed' || r.status === 'cancelled') return false;
      return new Date(r.dueDate) < now;
    }).length;
    const completed = revisions.filter(r => r.status === 'completed').length;
    return { scheduled, overdue, completed, total: revisions.length };
  }, [revisions]);

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <h1>Kalendář</h1>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewButton} ${viewMode === 'due' ? styles.active : ''}`}
            onClick={() => setViewMode('due')}
          >
            Termíny
          </button>
          <button
            className={`${styles.viewButton} ${viewMode === 'scheduled' ? styles.active : ''}`}
            onClick={() => setViewMode('scheduled')}
          >
            Naplánované
          </button>
        </div>
        <div className={styles.monthNav}>
          <button 
            className="btn-secondary" 
            onClick={goToPreviousMonth}
            aria-label="Předchozí měsíc"
          >
            ←
          </button>
          <button 
            className={styles.todayButton} 
            onClick={goToToday}
          >
            Dnes
          </button>
          <span className={styles.currentMonth}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button 
            className="btn-secondary" 
            onClick={goToNextMonth}
            aria-label="Další měsíc"
          >
            →
          </button>
        </div>
      </div>

      {/* Month stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{monthStats.scheduled}</span>
          <span className={styles.statLabel}>Naplánováno</span>
        </div>
        <div className={`${styles.stat} ${styles.statOverdue}`}>
          <span className={styles.statValue}>{monthStats.overdue}</span>
          <span className={styles.statLabel}>Po termínu</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{monthStats.completed}</span>
          <span className={styles.statLabel}>Dokončeno</span>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className={styles.error}>
          {error}
          <button onClick={loadRevisions}>Zkusit znovu</button>
        </div>
      )}

      {/* Calendar grid */}
      <div className="card">
        {isLoading ? (
          <div className={styles.loading}>Načítání kalendáře...</div>
        ) : (
          <CalendarGrid
            year={year}
            month={month}
            revisions={revisions}
            dateField={viewMode}
            onDayClick={handleDayClick}
          />
        )}
      </div>

      {/* Day details panel */}
      {selectedDay && (
        <div className={styles.detailsOverlay} onClick={handleCloseDetails}>
          <div className={styles.detailsPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.detailsHeader}>
              <h2>{selectedDay.dayNumber}. {MONTH_NAMES[selectedDay.date.getMonth()]}</h2>
              <button 
                className={styles.closeButton} 
                onClick={handleCloseDetails}
                aria-label="Zavřít"
              >
                ×
              </button>
            </div>
            
            {selectedRevisions.length === 0 ? (
              <div className={styles.emptyDay}>
                <p>Žádné revize pro tento den</p>
                <button className="btn-primary" onClick={handlePlanDay}>
                  Naplánovat den
                </button>
              </div>
            ) : (
              <>
                <div className={styles.revisionList}>
                  {selectedRevisions.map((revision) => (
                    <Link 
                      key={revision.id} 
                      to="/revisions/$revisionId"
                      params={{ revisionId: revision.id }}
                      className={`${styles.revisionItem} ${styles[`status-${revision.status}`]}`}
                    >
                      <div className={styles.revisionStatus}>
                        {getStatusLabel(revision.status)}
                      </div>
                      <div className={styles.revisionTime}>
                        {revision.scheduledTimeStart && (
                          <span>{revision.scheduledTimeStart.substring(0, 5)}</span>
                        )}
                      </div>
                      <div className={styles.revisionInfo}>
                        <span className={styles.revisionCustomer}>
                          {revision.customerName || 'Zákazník'}
                        </span>
                        <span className={styles.revisionDevice}>
                          {revision.deviceType || revision.deviceName || 'Zařízení'}
                        </span>
                      </div>
                      <span className={styles.revisionArrow}>→</span>
                    </Link>
                  ))}
                </div>
                <div className={styles.detailsActions}>
                  <button className="btn-primary" onClick={handlePlanDay}>
                    Otevřít v Plánovači
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.scheduledDot}`} />
          <span>Naplánováno</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.overdueDot}`} />
          <span>Po termínu</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.lowColor}`} />
          <span>1-2 revize</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.mediumColor}`} />
          <span>3-5 revizí</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.highColor}`} />
          <span>6+ revizí</span>
        </div>
      </div>
    </div>
  );
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    upcoming: 'Plánovaná',
    due_soon: 'Brzy',
    overdue: 'Po termínu',
    scheduled: 'Naplánováno',
    confirmed: 'Potvrzeno',
    completed: 'Dokončeno',
    cancelled: 'Zrušeno',
  };
  return labels[status] || status;
}
