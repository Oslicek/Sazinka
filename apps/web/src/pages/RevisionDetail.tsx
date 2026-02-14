import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { Revision } from '@shared/revision';
import { REVISION_STATUS_KEYS } from '@shared/revision';
import { 
  getRevision, 
  updateRevision,
  snoozeRevision,
  scheduleRevision,
} from '../services/revisionService';
import { RevisionWorkspace, type RevisionTabId } from '../components/revisions/RevisionWorkspace';
import { CompleteRevisionDialog } from '../components/revisions/CompleteRevisionDialog';
import { useNatsStore } from '../stores/natsStore';
import { formatDate } from '../i18n/formatters';
import styles from './RevisionDetail.module.css';

interface SearchParams {
  tab?: RevisionTabId;
}

export function RevisionDetail() {
  const { t } = useTranslation('pages');
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
      setError(t('revision_error_connection'));
      setIsLoading(false);
      return;
    }

    if (!revisionId) {
      setError(t('revision_error_no_id'));
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
      setError(err instanceof Error ? err.message : t('revision_error_load'));
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
      setError(err instanceof Error ? err.message : t('revision_error_schedule'));
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
      setError(err instanceof Error ? err.message : t('revision_error_snooze'));
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
    if (!confirm(t('revision_confirm_cancel'))) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await updateRevision({
        id: revision.id,
        status: 'cancelled',
      });
      await loadRevision();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('revision_error_cancel'));
    } finally {
      setIsSubmitting(false);
    }
  }, [revision, loadRevision]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('revision_loading')}</span>
        </div>
      </div>
    );
  }

  if (error && !revision) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>{t('revision_error')}</h2>
          <p>{error}</p>
          <Link to="/inbox" className={styles.backButton}>{t('revision_back_queue')}</Link>
        </div>
      </div>
    );
  }

  if (!revision) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>{t('revision_not_found')}</h2>
          <p>{t('revision_not_found_desc')}</p>
          <Link to="/inbox" className={styles.backButton}>{t('revision_back_queue')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header with breadcrumb and title */}
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/inbox" className={styles.backLink}>{t('revision_breadcrumb_queue')}</Link>
        </div>
        
        <div className={styles.titleRow}>
          <div className={styles.titleSection}>
            <h1 className={styles.title}>
              {revision.deviceName || revision.deviceType || t('revision_default_title')}
            </h1>
            <span className={`${styles.statusBadge} ${styles[`status-${revision.status}`]}`}>
              {REVISION_STATUS_KEYS[revision.status as keyof typeof REVISION_STATUS_KEYS] ? t(REVISION_STATUS_KEYS[revision.status as keyof typeof REVISION_STATUS_KEYS]) : revision.status}
            </span>
          </div>
          
          <div className={styles.headerMeta}>
            {revision.scheduledDate && (
              <span className={styles.metaItem}>
                📅 {formatDate(revision.scheduledDate)}
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
              <p>{t('revision_tab_progress_placeholder')}</p>
            </div>
          ),
          history: (
            <div className={styles.tabPlaceholder}>
              <p>{t('revision_tab_history_placeholder')}</p>
            </div>
          ),
        }}
      />

      {/* Schedule Dialog */}
      {showScheduleDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowScheduleDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{revision.scheduledDate ? t('revision_reschedule_title') : t('revision_schedule_title')}</h3>
            <div className={styles.dialogField}>
              <label>{t('revision_schedule_date')}</label>
              <input 
                type="date" 
                value={scheduleDate} 
                onChange={e => setScheduleDate(e.target.value)}
              />
            </div>
            <div className={styles.dialogRow}>
              <div className={styles.dialogField}>
                <label>{t('revision_schedule_time_from')}</label>
                <input 
                  type="time" 
                  value={scheduleTimeStart} 
                  onChange={e => setScheduleTimeStart(e.target.value)}
                />
              </div>
              <div className={styles.dialogField}>
                <label>{t('revision_schedule_time_to')}</label>
                <input 
                  type="time" 
                  value={scheduleTimeEnd} 
                  onChange={e => setScheduleTimeEnd(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.dialogField}>
              <label>{t('revision_schedule_duration')}</label>
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
                {t('common:cancel')}
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleSchedule}
                disabled={isSubmitting || !scheduleDate}
              >
                {isSubmitting ? t('common:loading') : t('revision_schedule_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snooze Dialog */}
      {showSnoozeDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowSnoozeDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{t('revision_snooze_title')}</h3>
            <div className={styles.dialogField}>
              <label>{t('revision_snooze_until')}</label>
              <input 
                type="date" 
                value={snoozeUntil} 
                onChange={e => setSnoozeUntil(e.target.value)}
              />
            </div>
            <div className={styles.dialogField}>
              <label>{t('revision_snooze_reason')}</label>
              <textarea 
                value={snoozeReason} 
                onChange={e => setSnoozeReason(e.target.value)}
                placeholder={t('revision_snooze_placeholder')}
                rows={3}
              />
            </div>
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowSnoozeDialog(false)}
                disabled={isSubmitting}
              >
                {t('common:cancel')}
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleSnooze}
                disabled={isSubmitting || !snoozeUntil}
              >
                {isSubmitting ? t('common:loading') : t('revision_snooze_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Dialog */}
      {showCompleteDialog && (
        <CompleteRevisionDialog
          revision={revision}
          onSuccess={handleCompleteSuccess}
          onCancel={() => setShowCompleteDialog(false)}
        />
      )}
    </div>
  );
}
