/**
 * WorkItemDetail page - Detail of a single work item (úkon)
 *
 * Shows work item information, duration, result, findings, and link to revision if applicable
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import type { VisitWorkItem } from '@shared/workItem';
import {
  getWorkItem,
  completeWorkItem,
  getWorkTypeLabel,
  getWorkTypeIcon,
  getWorkResultLabel,
} from '../services/workItemService';
import { useNatsStore } from '../stores/natsStore';
import styles from './WorkItemDetail.module.css';

export function WorkItemDetail() {
  const { workItemId } = useParams({ strict: false }) as { workItemId: string };
  const navigate = useNavigate();
  const isConnected = useNatsStore((s) => s.isConnected);

  const [workItem, setWorkItem] = useState<VisitWorkItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Complete dialog
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completeResult, setCompleteResult] = useState<'successful' | 'partial' | 'failed' | 'customer_absent' | 'rescheduled'>('successful');
  const [completeDuration, setCompleteDuration] = useState(45);
  const [completeNotes, setCompleteNotes] = useState('');
  const [completeFindings, setCompleteFindings] = useState('');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [followUpReason, setFollowUpReason] = useState('');

  const loadWorkItem = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    if (!workItemId) {
      setError('ID úkonu není zadáno');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await getWorkItem(workItemId);
      setWorkItem(data);
    } catch (err) {
      console.error('Failed to load work item:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst úkon');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, workItemId]);

  useEffect(() => {
    loadWorkItem();
  }, [loadWorkItem]);

  // Complete handler
  const handleComplete = useCallback(async () => {
    if (!workItem) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await completeWorkItem({
        id: workItem.id,
        result: completeResult,
        durationMinutes: completeDuration,
        resultNotes: completeNotes || undefined,
        findings: completeFindings || undefined,
      });
      setShowCompleteDialog(false);
      await loadWorkItem();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit úkon');
    } finally {
      setIsSubmitting(false);
    }
  }, [workItem, completeResult, completeDuration, completeNotes, completeFindings, loadWorkItem]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Načítám úkon...</span>
        </div>
      </div>
    );
  }

  if (error && !workItem) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>Chyba</h2>
          <p>{error}</p>
          <Link to="/worklog" className={styles.backButton}>← Zpět na záznam práce</Link>
        </div>
      </div>
    );
  }

  if (!workItem) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>Úkon nenalezen</h2>
          <p>Požadovaný úkon neexistuje nebo byl smazán.</p>
          <Link to="/worklog" className={styles.backButton}>← Zpět na záznam práce</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/worklog" className={styles.backLink}>← Záznam práce</Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <Link 
            to="/visits/$visitId" 
            params={{ visitId: workItem.visitId }}
            className={styles.backLink}
          >
            Návštěva
          </Link>
        </div>

        <div className={styles.titleRow}>
          <div className={styles.titleSection}>
            <span className={styles.icon}>{getWorkTypeIcon(workItem.workType)}</span>
            <h1 className={styles.title}>
              {getWorkTypeLabel(workItem.workType)}
            </h1>
            {workItem.result && (
              <span className={`${styles.resultBadge} ${styles[`result-${workItem.result}`]}`}>
                {getWorkResultLabel(workItem.result)}
              </span>
            )}
          </div>

          <div className={styles.headerMeta}>
            {workItem.durationMinutes && (
              <span className={styles.metaItem}>
                ⏱️ {workItem.durationMinutes} min
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

      {/* Main content */}
      <div className={styles.content}>
        {/* Left column */}
        <div className={styles.mainColumn}>
          {/* Basic info card */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Základní informace</h3>
            <div className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Typ úkonu</span>
                <span className={styles.detailValue}>
                  {getWorkTypeIcon(workItem.workType)} {getWorkTypeLabel(workItem.workType)}
                </span>
              </div>
              
              {workItem.deviceId && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Zařízení</span>
                  <span className={styles.detailValue}>{workItem.deviceId}</span>
                </div>
              )}

              {workItem.durationMinutes && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Délka trvání</span>
                  <span className={styles.detailValue}>{workItem.durationMinutes} minut</span>
                </div>
              )}

              {workItem.result && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Výsledek</span>
                  <span className={`${styles.resultBadge} ${styles[`result-${workItem.result}`]}`}>
                    {getWorkResultLabel(workItem.result)}
                  </span>
                </div>
              )}
            </div>

            {workItem.resultNotes && (
              <div className={styles.notesSection}>
                <span className={styles.detailLabel}>Poznámky</span>
                <p className={styles.notes}>{workItem.resultNotes}</p>
              </div>
            )}

            {workItem.findings && (
              <div className={styles.findingsSection}>
                <span className={styles.detailLabel}>Nálezy</span>
                <p className={styles.findings}>{workItem.findings}</p>
              </div>
            )}

            {workItem.requiresFollowUp && (
              <div className={styles.followUpSection}>
                <span className={styles.followUpBadge}>🔔 Vyžaduje následnou návštěvu</span>
                {workItem.followUpReason && (
                  <p className={styles.followUpReason}>{workItem.followUpReason}</p>
                )}
              </div>
            )}
          </div>

          {/* Revision link */}
          {workItem.revisionId && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Související revize</h3>
              <Link 
                to="/revisions/$revisionId" 
                params={{ revisionId: workItem.revisionId }}
                className={styles.revisionLink}
              >
                <span>🔍</span>
                <span>Zobrazit detail revize</span>
                <span className={styles.arrow}>→</span>
              </Link>
            </div>
          )}

          {/* Protocol placeholder */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Revizní protokol</h3>
            <p className={styles.placeholder}>
              Formulář revizního protokolu bude implementován v budoucnu.
            </p>
          </div>
        </div>

        {/* Right column - Actions panel */}
        <div className={styles.actionsPanel}>
          <h3 className={styles.panelTitle}>Akce</h3>

          <div className={styles.actions}>
            {!workItem.result && (
              <button 
                className={styles.actionButton}
                onClick={() => setShowCompleteDialog(true)}
                disabled={isSubmitting}
              >
                ✅ Dokončit úkon
              </button>
            )}
            <Link 
              to="/visits/$visitId" 
              params={{ visitId: workItem.visitId }}
              className={styles.actionButton}
            >
              📋 Zobrazit návštěvu
            </Link>
          </div>
        </div>
      </div>

      {/* Complete Dialog */}
      {showCompleteDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowCompleteDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>Dokončit úkon</h3>
            <div className={styles.dialogField}>
              <label>Výsledek *</label>
              <select 
                value={completeResult} 
                onChange={e => setCompleteResult(e.target.value as any)}
              >
                <option value="successful">Úspěšně</option>
                <option value="partial">Částečně</option>
                <option value="failed">Neúspěšně</option>
                <option value="customer_absent">Zákazník nepřítomen</option>
                <option value="rescheduled">Přeplánováno</option>
              </select>
            </div>
            <div className={styles.dialogField}>
              <label>Délka trvání (min) *</label>
              <input 
                type="number" 
                value={completeDuration} 
                onChange={e => setCompleteDuration(parseInt(e.target.value) || 45)}
                min="5"
                step="5"
              />
            </div>
            <div className={styles.dialogField}>
              <label>Poznámky</label>
              <textarea 
                value={completeNotes} 
                onChange={e => setCompleteNotes(e.target.value)}
                placeholder="Poznámky k úkonu..."
                rows={3}
              />
            </div>
            <div className={styles.dialogField}>
              <label>Nálezy</label>
              <textarea 
                value={completeFindings} 
                onChange={e => setCompleteFindings(e.target.value)}
                placeholder="Zjištěné závady nebo nálezy..."
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
                {isSubmitting ? 'Ukládám...' : 'Dokončit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
