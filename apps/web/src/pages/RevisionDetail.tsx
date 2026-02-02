import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import type { Revision } from '@shared/revision';
import { REVISION_STATUS_LABELS, REVISION_RESULT_LABELS } from '@shared/revision';
import { 
  getRevision, 
  updateRevision,
  completeRevision,
  snoozeRevision,
  scheduleRevision,
  type CompleteRevisionRequest,
} from '../services/revisionService';
import { useNatsStore } from '../stores/natsStore';
import styles from './RevisionDetail.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

type WorkflowState = 'awaiting_contact' | 'scheduled' | 'planned' | 'completed' | 'cancelled';

function getWorkflowState(revision: Revision): WorkflowState {
  if (revision.status === 'completed') return 'completed';
  if (revision.status === 'cancelled') return 'cancelled';
  if (revision.scheduledDate) {
    // Has a scheduled date - could be scheduled or planned
    return revision.status === 'confirmed' ? 'planned' : 'scheduled';
  }
  return 'awaiting_contact';
}

function getNextStepText(state: WorkflowState): string {
  switch (state) {
    case 'awaiting_contact': return 'Další krok: domluvit termín';
    case 'scheduled': return 'Další krok: naplánovat v trase';
    case 'planned': return 'Další krok: provést revizi';
    case 'completed': return 'Revize dokončena';
    case 'cancelled': return 'Revize zrušena';
  }
}

export function RevisionDetail() {
  const { revisionId } = useParams({ strict: false }) as { revisionId: string };
  const navigate = useNavigate();
  const isConnected = useNatsStore((s) => s.isConnected);

  const [revision, setRevision] = useState<Revision | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const [completeResult, setCompleteResult] = useState<'passed' | 'conditional' | 'failed'>('passed');
  const [completeDuration, setCompleteDuration] = useState('');
  const [completeFindings, setCompleteFindings] = useState('');

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
      const data = await getRevision(TEMP_USER_ID, revisionId);
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
      await scheduleRevision(TEMP_USER_ID, {
        id: revision.id,
        scheduledDate: scheduleDate,
        scheduledTimeStart: scheduleTimeStart || undefined,
        scheduledTimeEnd: scheduleTimeEnd || undefined,
        durationMinutes: scheduleDuration,
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
  }, [revision, scheduleDate, scheduleTimeStart, scheduleTimeEnd, scheduleDuration, loadRevision, navigate]);

  // Snooze handler
  const handleSnooze = useCallback(async () => {
    if (!revision || !snoozeUntil) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await snoozeRevision(TEMP_USER_ID, {
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

  // Complete handler
  const handleComplete = useCallback(async () => {
    if (!revision) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const data: CompleteRevisionRequest = {
        id: revision.id,
        result: completeResult,
        findings: completeFindings || undefined,
        durationMinutes: completeDuration ? parseInt(completeDuration, 10) : undefined,
      };
      await completeRevision(TEMP_USER_ID, data);
      setShowCompleteDialog(false);
      await loadRevision();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [revision, completeResult, completeFindings, completeDuration, loadRevision]);

  // Cancel handler
  const handleCancel = useCallback(async () => {
    if (!revision) return;
    if (!confirm('Opravdu chcete zrušit tuto revizi?')) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await updateRevision(TEMP_USER_ID, {
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
    return <div className={styles.loading}>Načítání...</div>;
  }

  if (error && !revision) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
        <Link to="/queue" className={styles.backLink}>← Zpět na frontu</Link>
      </div>
    );
  }

  if (!revision) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Revize nenalezena</div>
        <Link to="/queue" className={styles.backLink}>← Zpět na frontu</Link>
      </div>
    );
  }

  const workflowState = getWorkflowState(revision);
  const isCompleted = revision.status === 'completed';
  const isCancelled = revision.status === 'cancelled';
  const canSchedule = !revision.scheduledDate && !isCompleted && !isCancelled;
  const canReschedule = revision.scheduledDate && !isCompleted && !isCancelled;
  const canSnooze = !isCompleted && !isCancelled;
  const canComplete = !isCompleted && !isCancelled;
  const canCancel = !isCompleted && !isCancelled;

  return (
    <div className={styles.container}>
      {/* Sticky Header */}
      <header className={styles.header}>
        <Link to="/queue" className={styles.backLink}>← Zpět na frontu</Link>
        
        <div className={styles.headerMain}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              Revize - {revision.deviceType || 'Zařízení'}
            </h1>
            <span className={`${styles.statusBadge} ${styles[`status-${revision.status}`]}`}>
              {REVISION_STATUS_LABELS[revision.status as keyof typeof REVISION_STATUS_LABELS] || revision.status}
            </span>
          </div>

          <div className={styles.headerMeta}>
            {revision.scheduledDate && (
              <span className={styles.metaItem}>
                <strong>Termín:</strong> {new Date(revision.scheduledDate).toLocaleDateString('cs-CZ')}
              </span>
            )}
            {revision.scheduledTimeStart && revision.scheduledTimeEnd && (
              <span className={styles.metaItem}>
                <strong>Okno:</strong> {revision.scheduledTimeStart.substring(0, 5)} - {revision.scheduledTimeEnd.substring(0, 5)}
              </span>
            )}
            <span className={styles.metaItem}>
              <strong>Termín revize:</strong> {new Date(revision.dueDate).toLocaleDateString('cs-CZ')}
            </span>
          </div>

          <div className={styles.headerActions}>
            {/* Primary CTA */}
            {canSchedule && (
              <button 
                className={styles.primaryButton}
                onClick={() => setShowScheduleDialog(true)}
                disabled={isSubmitting}
              >
                Domluvit termín
              </button>
            )}
            {canReschedule && (
              <Link 
                to="/planner" 
                search={{ date: revision.scheduledDate }}
                className={styles.primaryButton}
              >
                Otevřít v plánovači
              </Link>
            )}
            {isCompleted && revision.result && (
              <span className={`${styles.resultBadge} ${styles[`result-${revision.result}`]}`}>
                {REVISION_RESULT_LABELS[revision.result as keyof typeof REVISION_RESULT_LABELS]}
              </span>
            )}

            {/* Secondary actions */}
            {canReschedule && (
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowScheduleDialog(true)}
                disabled={isSubmitting}
              >
                Přeplánovat
              </button>
            )}
            {canSnooze && (
              <button 
                className={styles.secondaryButton}
                onClick={() => setShowSnoozeDialog(true)}
                disabled={isSubmitting}
              >
                Odložit
              </button>
            )}
            {canCancel && (
              <button 
                className={styles.dangerButton}
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                Zrušit
              </button>
            )}
          </div>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.content}>
        {/* Left column - Customer & Revision details */}
        <div className={styles.mainColumn}>
          {/* Customer card */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Zákazník</h2>
            <div className={styles.cardContent}>
              <p className={styles.customerName}>{revision.customerName || 'Neznámý zákazník'}</p>
              {(revision.customerStreet || revision.customerCity) && (
                <p className={styles.address}>
                  {revision.customerStreet}
                  {revision.customerStreet && revision.customerCity && ', '}
                  {revision.customerCity} {revision.customerPostalCode}
                </p>
              )}
              <div className={styles.cardActions}>
                {revision.customerPhone && (
                  <a href={`tel:${revision.customerPhone}`} className={styles.actionButton}>
                    📞 Zavolat
                  </a>
                )}
                <Link to="/customers/$customerId" params={{ customerId: revision.customerId }} className={styles.actionButton}>
                  👤 Detail zákazníka
                </Link>
              </div>
            </div>
          </section>

          {/* Revision card */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Detail revize</h2>
            <div className={styles.cardContent}>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Zařízení:</span>
                  <span className={styles.detailValue}>{revision.deviceName || revision.deviceType || '-'}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Termín revize:</span>
                  <span className={styles.detailValue}>{new Date(revision.dueDate).toLocaleDateString('cs-CZ')}</span>
                </div>
                {revision.scheduledDate && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Naplánováno:</span>
                    <span className={styles.detailValue}>{new Date(revision.scheduledDate).toLocaleDateString('cs-CZ')}</span>
                  </div>
                )}
                {revision.completedAt && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Dokončeno:</span>
                    <span className={styles.detailValue}>{new Date(revision.completedAt).toLocaleString('cs-CZ')}</span>
                  </div>
                )}
                {revision.durationMinutes && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Délka:</span>
                    <span className={styles.detailValue}>{revision.durationMinutes} min</span>
                  </div>
                )}
              </div>
              {revision.findings && (
                <div className={styles.findings}>
                  <span className={styles.detailLabel}>Poznámky:</span>
                  <p>{revision.findings}</p>
                </div>
              )}
              <div className={styles.cardActions}>
                <Link to="/customers/$customerId" params={{ customerId: revision.customerId }} className={styles.actionButton}>
                  🔧 Detail zařízení
                </Link>
              </div>
            </div>
          </section>

          {/* Timeline placeholder */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Historie a komunikace</h2>
            <div className={styles.cardContent}>
              <p className={styles.placeholder}>Timeline komunikace a návštěv bude doplněna.</p>
            </div>
          </section>
        </div>

        {/* Right column - Workflow panel */}
        <aside className={styles.workflowPanel}>
          <h2 className={styles.panelTitle}>Workflow</h2>
          <p className={styles.nextStep}>{getNextStepText(workflowState)}</p>

          <div className={styles.workflowActions}>
            {canSchedule && (
              <button 
                className={styles.workflowButton}
                onClick={() => setShowScheduleDialog(true)}
                disabled={isSubmitting}
              >
                📅 Domluvit termín
              </button>
            )}
            {canReschedule && (
              <>
                <Link 
                  to="/planner" 
                  search={{ date: revision.scheduledDate }}
                  className={styles.workflowButton}
                >
                  🗓️ Otevřít v plánovači
                </Link>
                <button 
                  className={styles.workflowButton}
                  onClick={() => setShowScheduleDialog(true)}
                  disabled={isSubmitting}
                >
                  🔄 Přeplánovat
                </button>
              </>
            )}
            {canComplete && (
              <button 
                className={styles.workflowButton}
                onClick={() => setShowCompleteDialog(true)}
                disabled={isSubmitting}
              >
                ✅ Označit jako hotovo
              </button>
            )}
            {canSnooze && (
              <button 
                className={styles.workflowButton}
                onClick={() => setShowSnoozeDialog(true)}
                disabled={isSubmitting}
              >
                ⏰ Odložit
              </button>
            )}
            {revision.customerPhone && (
              <a href={`tel:${revision.customerPhone}`} className={styles.workflowButton}>
                📞 Zavolat zákazníkovi
              </a>
            )}
            {canCancel && (
              <button 
                className={`${styles.workflowButton} ${styles.workflowDanger}`}
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                ❌ Zrušit revizi
              </button>
            )}
          </div>

          {/* Operations section */}
          <div className={styles.operationsSection}>
            <h3 className={styles.operationsTitle}>Operativa</h3>
            <button className={styles.operationButton}>🖨️ Tisk</button>
            {(revision.customerStreet || revision.customerCity) && (
              <a 
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                  `${revision.customerStreet || ''}, ${revision.customerCity || ''} ${revision.customerPostalCode || ''}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.operationButton}
              >
                🧭 Navigovat
              </a>
            )}
          </div>
        </aside>
      </div>

      {/* Schedule Dialog */}
      {showScheduleDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowScheduleDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{canReschedule ? 'Přeplánovat revizi' : 'Domluvit termín'}</h3>
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
        <div className={styles.dialogOverlay} onClick={() => setShowCompleteDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>Dokončit revizi</h3>
            <div className={styles.dialogField}>
              <label>Výsledek *</label>
              <select 
                value={completeResult} 
                onChange={e => setCompleteResult(e.target.value as typeof completeResult)}
              >
                <option value="passed">V pořádku</option>
                <option value="conditional">S výhradami</option>
                <option value="failed">Nevyhovělo</option>
              </select>
            </div>
            <div className={styles.dialogField}>
              <label>Délka (min)</label>
              <input 
                type="number" 
                value={completeDuration} 
                onChange={e => setCompleteDuration(e.target.value)}
                placeholder="např. 45"
                min="1"
              />
            </div>
            <div className={styles.dialogField}>
              <label>Poznámky</label>
              <textarea 
                value={completeFindings} 
                onChange={e => setCompleteFindings(e.target.value)}
                placeholder="Poznámky k revizi..."
                rows={3}
              />
            </div>
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowCompleteDialog(false)}
                disabled={isSubmitting}
              >
                Zrušit
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleComplete}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Ukládám...' : 'Dokončit revizi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
