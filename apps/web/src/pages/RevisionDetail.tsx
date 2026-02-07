import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { Revision } from '@shared/revision';
import { REVISION_STATUS_LABELS } from '@shared/revision';
import { 
  getRevision, 
  updateRevision,
  snoozeRevision,
  scheduleRevision,
} from '../services/revisionService';
import { RevisionWorkspace, type RevisionTabId } from '../components/revisions/RevisionWorkspace';
import { CompleteRevisionDialog } from '../components/revisions/CompleteRevisionDialog';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';
import styles from './RevisionDetail.module.css';

interface SearchParams {
  tab?: RevisionTabId;
}

export function RevisionDetail() {
  const { revisionId } = useParams({ strict: false }) as { revisionId: string };
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as SearchParams;
  const isConnected = useNatsStore((s) => s.isConnected);

  const [revision, setRevision] = useState<Revision | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<RevisionTabId>(searchParams?.tab || 'progress');

  // Schedule dialog state
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTimeStart, setScheduleTimeStart] = useState('');
  const [scheduleTimeEnd, setScheduleTimeEnd] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState(45);

  // Snooze dialog state
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState('');
  const [snoozeReason, setSnoozeReason] = useState('');

  // Complete dialog state
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  const loadRevision = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    if (!revisionId) {
      setError('ID revize není zadáno');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await getRevision(revisionId);
      setRevision(data);
    } catch (err) {
      console.error('Failed to load revision:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst revizi');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, revisionId]);

  useEffect(() => {
    loadRevision();
  }, [loadRevision]);

  // Schedule handler
  const handleSchedule = useCallback(async () => {
    if (!revision || !scheduleDate) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await scheduleRevision({
        id: revision.id,
        scheduledDate: scheduleDate,
        timeWindowStart: scheduleTimeStart || undefined,
        timeWindowEnd: scheduleTimeEnd || undefined,
      });
      setShowScheduleDialog(false);
      await loadRevision();
      // Navigate to planner for that date
      navigate({ to: '/planner', search: { date: scheduleDate } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se naplánovat revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [revision, scheduleDate, scheduleTimeStart, scheduleTimeEnd, loadRevision, navigate]);

  // Snooze handler
  const handleSnooze = useCallback(async () => {
    if (!revision || !snoozeUntil) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await snoozeRevision({
        id: revision.id,
        snoozeUntil,
        reason: snoozeReason || undefined,
      });
      setShowSnoozeDialog(false);
      await loadRevision();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se odložit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [revision, snoozeUntil, snoozeReason, loadRevision]);

  // Complete dialog success handler
  const handleCompleteSuccess = useCallback(async () => {
    setShowCompleteDialog(false);
    await loadRevision();
  }, [loadRevision]);

  // Tab change handler
  const handleTabChange = useCallback((tab: RevisionTabId) => {
    setActiveTab(tab);
  }, []);

  // Cancel handler
  const handleCancel = useCallback(async () => {
    if (!revision) return;
    if (!confirm('Opravdu chcete zrušit tuto revizi?')) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await updateRevision({
        id: revision.id,
        status: 'cancelled',
      });
      await loadRevision();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se zrušit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [revision, loadRevision]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Načítám revizi...</span>
        </div>
      </div>
    );
  }

  if (error && !revision) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>Chyba</h2>
          <p>{error}</p>
          <Link to="/inbox" className={styles.backButton}>← Zpět na frontu</Link>
        </div>
      </div>
    );
  }

  if (!revision) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>Revize nenalezena</h2>
          <p>Požadovaná revize neexistuje nebo byla smazána.</p>
          <Link to="/inbox" className={styles.backButton}>← Zpět na frontu</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header with breadcrumb and title */}
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/inbox" className={styles.backLink}>← Fronta</Link>
        </div>
        
        <div className={styles.titleRow}>
          <div className={styles.titleSection}>
            <h1 className={styles.title}>
              {revision.deviceName || revision.deviceType || 'Revize'}
            </h1>
            <span className={`${styles.statusBadge} ${styles[`status-${revision.status}`]}`}>
              {REVISION_STATUS_LABELS[revision.status as keyof typeof REVISION_STATUS_LABELS] || revision.status}
            </span>
          </div>
          
          <div className={styles.headerMeta}>
            {revision.scheduledDate && (
              <span className={styles.metaItem}>
                📅 {new Date(revision.scheduledDate).toLocaleDateString('cs-CZ')}
              </span>
            )}
            {revision.scheduledTimeStart && revision.scheduledTimeEnd && (
              <span className={styles.metaItem}>
                🕐 {revision.scheduledTimeStart.substring(0, 5)} - {revision.scheduledTimeEnd.substring(0, 5)}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Main workspace with 2-column layout */}
      <RevisionWorkspace
        revision={revision}
        onSchedule={() => setShowScheduleDialog(true)}
        onReschedule={() => setShowScheduleDialog(true)}
        onSnooze={() => setShowSnoozeDialog(true)}
        onComplete={() => setShowCompleteDialog(true)}
        onCancel={handleCancel}
        isSubmitting={isSubmitting}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        tabs={{
          progress: (
            <div className={styles.tabPlaceholder}>
              <p>Průběh revize a její výsledky budou zobrazeny zde.</p>
            </div>
          ),
          history: (
            <div className={styles.tabPlaceholder}>
              <p>Historie návštěv a změn bude zobrazena zde.</p>
            </div>
          ),
        }}
      />

      {/* Schedule Dialog */}
      {showScheduleDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowScheduleDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{revision.scheduledDate ? 'Přeplánovat revizi' : 'Domluvit termín'}</h3>
            <div className={styles.dialogField}>
              <label>Datum *</label>
              <input 
                type="date" 
                value={scheduleDate} 
                onChange={e => setScheduleDate(e.target.value)}
              />
            </div>
            <div className={styles.dialogRow}>
              <div className={styles.dialogField}>
                <label>Čas od</label>
                <input 
                  type="time" 
                  value={scheduleTimeStart} 
                  onChange={e => setScheduleTimeStart(e.target.value)}
                />
              </div>
              <div className={styles.dialogField}>
                <label>Čas do</label>
                <input 
                  type="time" 
                  value={scheduleTimeEnd} 
                  onChange={e => setScheduleTimeEnd(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.dialogField}>
              <label>Délka (min)</label>
              <input 
                type="number" 
                value={scheduleDuration} 
                onChange={e => setScheduleDuration(parseInt(e.target.value) || 45)}
                min="15"
                step="15"
              />
            </div>
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowScheduleDialog(false)}
                disabled={isSubmitting}
              >
                Zrušit
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleSchedule}
                disabled={isSubmitting || !scheduleDate}
              >
                {isSubmitting ? 'Ukládám...' : 'Potvrdit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snooze Dialog */}
      {showSnoozeDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowSnoozeDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>Odložit revizi</h3>
            <div className={styles.dialogField}>
              <label>Odložit do *</label>
              <input 
                type="date" 
                value={snoozeUntil} 
                onChange={e => setSnoozeUntil(e.target.value)}
              />
            </div>
            <div className={styles.dialogField}>
              <label>Důvod</label>
              <textarea 
                value={snoozeReason} 
                onChange={e => setSnoozeReason(e.target.value)}
                placeholder="Volitelný důvod odložení..."
                rows={3}
              />
            </div>
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowSnoozeDialog(false)}
                disabled={isSubmitting}
              >
                Zrušit
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleSnooze}
                disabled={isSubmitting || !snoozeUntil}
              >
                {isSubmitting ? 'Ukládám...' : 'Odložit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Dialog */}
      {showCompleteDialog && (
        <CompleteRevisionDialog
          revision={revision}
          userId={getToken()}
          onSuccess={handleCompleteSuccess}
          onCancel={() => setShowCompleteDialog(false)}
        />
      )}
    </div>
  );
}
