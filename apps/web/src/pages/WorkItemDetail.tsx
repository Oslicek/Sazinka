/**
 * WorkItemDetail page - Detail of a single work item (úkon)
 *
 * Shows work item information, duration, result, findings, and link to revision if applicable
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('pages');
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
      setError(t('workitem_error_connection'));
      setIsLoading(false);
      return;
    }

    if (!workItemId) {
      setError(t('workitem_error_no_id'));
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
      setError(err instanceof Error ? err.message : t('workitem_error_load'));
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
      setError(err instanceof Error ? err.message : t('workitem_error_complete'));
    } finally {
      setIsSubmitting(false);
    }
  }, [workItem, completeResult, completeDuration, completeNotes, completeFindings, loadWorkItem]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('workitem_loading')}</span>
        </div>
      </div>
    );
  }

  if (error && !workItem) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>{t('workitem_error_title')}</h2>
          <p>{error}</p>
          <Link to="/worklog" className={styles.backButton}>{t('workitem_back_worklog')}</Link>
        </div>
      </div>
    );
  }

  if (!workItem) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>{t('workitem_not_found')}</h2>
          <p>{t('workitem_not_found_desc')}</p>
          <Link to="/worklog" className={styles.backButton}>{t('workitem_back_worklog')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/worklog" className={styles.backLink}>{t('workitem_breadcrumb_worklog')}</Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <Link 
            to="/visits/$visitId" 
            params={{ visitId: workItem.visitId }}
            className={styles.backLink}
          >
            {t('workitem_breadcrumb_visit')}
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
            <h3 className={styles.cardTitle}>{t('workitem_basic_info')}</h3>
            <div className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('workitem_type')}</span>
                <span className={styles.detailValue}>
                  {getWorkTypeIcon(workItem.workType)} {getWorkTypeLabel(workItem.workType)}
                </span>
              </div>
              
              {workItem.deviceId && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('workitem_device')}</span>
                  <span className={styles.detailValue}>{workItem.deviceId}</span>
                </div>
              )}

              {workItem.durationMinutes && (
                <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('workitem_duration')}</span>
                <span className={styles.detailValue}>{workItem.durationMinutes} {t('workitem_minutes')}</span>
                </div>
              )}

              {workItem.result && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('workitem_result')}</span>
                  <span className={`${styles.resultBadge} ${styles[`result-${workItem.result}`]}`}>
                    {getWorkResultLabel(workItem.result)}
                  </span>
                </div>
              )}
            </div>

            {workItem.resultNotes && (
              <div className={styles.notesSection}>
                <span className={styles.detailLabel}>{t('workitem_notes')}</span>
                <p className={styles.notes}>{workItem.resultNotes}</p>
              </div>
            )}

            {workItem.findings && (
              <div className={styles.findingsSection}>
                <span className={styles.detailLabel}>{t('workitem_findings')}</span>
                <p className={styles.findings}>{workItem.findings}</p>
              </div>
            )}

            {workItem.requiresFollowUp && (
              <div className={styles.followUpSection}>
                <span className={styles.followUpBadge}>🔔 {t('workitem_requires_follow_up')}</span>
                {workItem.followUpReason && (
                  <p className={styles.followUpReason}>{workItem.followUpReason}</p>
                )}
              </div>
            )}
          </div>

          {/* Revision link */}
          {workItem.revisionId && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>{t('workitem_related_revision')}</h3>
              <Link 
                to="/revisions/$revisionId" 
                params={{ revisionId: workItem.revisionId }}
                className={styles.revisionLink}
              >
                <span>🔍</span>
                <span>{t('workitem_view_revision')}</span>
                <span className={styles.arrow}>→</span>
              </Link>
            </div>
          )}

          {/* Protocol placeholder */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{t('workitem_protocol')}</h3>
            <p className={styles.placeholder}>
              {t('workitem_protocol_placeholder')}
            </p>
          </div>
        </div>

        {/* Right column - Actions panel */}
        <div className={styles.actionsPanel}>
          <h3 className={styles.panelTitle}>{t('workitem_actions')}</h3>

          <div className={styles.actions}>
            {!workItem.result && (
              <button 
                className={styles.actionButton}
                onClick={() => setShowCompleteDialog(true)}
                disabled={isSubmitting}
              >
                ✅ {t('workitem_complete')}
              </button>
            )}
            <Link 
              to="/visits/$visitId" 
              params={{ visitId: workItem.visitId }}
              className={styles.actionButton}
            >
              📋 {t('workitem_view_visit')}
            </Link>
          </div>
        </div>
      </div>

      {/* Complete Dialog */}
      {showCompleteDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowCompleteDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{t('workitem_complete_dialog')}</h3>
            <div className={styles.dialogField}>
              <label>{t('workitem_complete_result')}</label>
              <select 
                value={completeResult} 
                onChange={e => setCompleteResult(e.target.value as any)}
              >
                <option value="successful">{t('visit_result_successful')}</option>
                <option value="partial">{t('visit_result_partial')}</option>
                <option value="failed">{t('visit_result_failed')}</option>
                <option value="customer_absent">{t('visit_result_customer_absent')}</option>
                <option value="rescheduled">{t('visit_result_rescheduled')}</option>
              </select>
            </div>
            <div className={styles.dialogField}>
              <label>{t('workitem_complete_duration')}</label>
              <input 
                type="number" 
                value={completeDuration} 
                onChange={e => setCompleteDuration(parseInt(e.target.value) || 45)}
                min="5"
                step="5"
              />
            </div>
            <div className={styles.dialogField}>
              <label>{t('workitem_complete_notes')}</label>
              <textarea 
                value={completeNotes} 
                onChange={e => setCompleteNotes(e.target.value)}
                placeholder={t('workitem_complete_notes_placeholder')}
                rows={3}
              />
            </div>
            <div className={styles.dialogField}>
              <label>{t('workitem_complete_findings')}</label>
              <textarea 
                value={completeFindings} 
                onChange={e => setCompleteFindings(e.target.value)}
                placeholder={t('workitem_complete_findings_placeholder')}
                rows={3}
              />
            </div>
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowCompleteDialog(false)}
                disabled={isSubmitting}
              >
                {t('workitem_cancel')}
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleComplete}
                disabled={isSubmitting}
              >
                {isSubmitting ? t('workitem_saving') : t('workitem_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
