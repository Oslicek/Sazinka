/**
 * WorkItemDetail page - Detail of a single work item (úkon)
 *
 * Shows work item information, duration, result, findings, and link to revision if applicable
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { VisitWorkItem } from '@shared/workItem';
import type { Note } from '@shared/note';
import {
  getWorkItem,
  completeWorkItem,
  getWorkTypeLabel,
  getWorkResultLabel,
  type WorkType,
} from '../services/workItemService';
import { listNotes, createNote } from '../services/noteService';
import { useNatsStore } from '../stores/natsStore';
import { Search, Clock, Bell, Check, ClipboardList, Wrench, Settings, MessageSquare, RefreshCcw, Plus } from 'lucide-react';
import { InlineNoteEditor } from '../components/notes/InlineNoteEditor';

function WorkTypeIcon({ type }: { type: WorkType }) {
  switch (type) {
    case 'revision': return <Search size={14} />;
    case 'repair': return <Wrench size={14} />;
    case 'installation': return <Settings size={14} />;
    case 'consultation': return <MessageSquare size={14} />;
    case 'follow_up': return <RefreshCcw size={14} />;
    default: return <ClipboardList size={14} />;
  }
}
import styles from './WorkItemDetail.module.css';

export function WorkItemDetail() {
  const { workItemId } = useParams({ strict: false }) as { workItemId: string };
  const { t } = useTranslation('pages');
  const isConnected = useNatsStore((s) => s.isConnected);

  const [workItem, setWorkItem] = useState<VisitWorkItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Unified device notes
  const [deviceNotes, setDeviceNotes] = useState<Note[]>([]);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

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

  useEffect(() => {
    let cancelled = false;
    if (workItem?.deviceId) {
      listNotes('device', workItem.deviceId)
        .then((notes) => { if (!cancelled) setDeviceNotes(notes); })
        .catch((err) => {
          console.error('Failed to load device notes:', err);
          if (!cancelled) setDeviceNotes([]);
        });
    } else {
      setDeviceNotes([]);
    }
    return () => { cancelled = true; };
  }, [workItem?.deviceId]);

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
          <AlertTriangle size={16} className={styles.errorIcon} />
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
          <Search size={16} className={styles.errorIcon} />
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
            <span className={styles.icon}><WorkTypeIcon type={workItem.workType} /></span>
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
                <Clock size={14} /> {workItem.durationMinutes} min
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={14} />
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
                  <WorkTypeIcon type={workItem.workType} /> {getWorkTypeLabel(workItem.workType)}
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

            {workItem.requiresFollowUp && (
              <div className={styles.followUpSection}>
                <span className={styles.followUpBadge}><Bell size={14} /> {t('workitem_requires_follow_up')}</span>
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
                <Search size={14} />
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

          {/* Unified device notes */}
          {workItem.deviceId && (
            <div className={styles.card} data-testid="device-notes-section">
              <div className={styles.cardTitleRow}>
                <h3 className={styles.cardTitle}>{t('workitem_device_notes')}</h3>
                <button
                  className={styles.addNoteBtn}
                  data-testid="add-device-note-btn"
                  onClick={async () => {
                    try {
                      const note = await createNote({
                        entityType: 'device',
                        entityId: workItem.deviceId!,
                        visitId: workItem.visitId,
                        sessionId: sessionIdRef.current,
                        content: '',
                      });
                      setDeviceNotes((prev) => [...prev, note]);
                    } catch (err) {
                      console.error('Failed to create device note:', err);
                    }
                  }}
                >
                  <Plus size={14} /> {t('workitem_add_note')}
                </button>
              </div>
              {deviceNotes.length === 0 ? (
                <p className={styles.placeholder} data-testid="device-notes-empty">
                  {t('workitem_device_notes_empty')}
                </p>
              ) : (
                <div className={styles.notesList} data-testid="device-notes-list">
                  {deviceNotes.map((note) => (
                    <InlineNoteEditor
                      key={note.id}
                      note={note}
                      sessionId={sessionIdRef.current}
                      onSaved={(updated) =>
                        setDeviceNotes((prev) =>
                          prev.map((n) => (n.id === updated.id ? updated : n))
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
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
                <Check size={14} /> {t('workitem_complete')}
              </button>
            )}
            <Link 
              to="/visits/$visitId" 
              params={{ visitId: workItem.visitId }}
              className={styles.actionButton}
            >
              <ClipboardList size={14} /> {t('workitem_view_visit')}
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
              <p className={styles.dialogNotesHint}>{t('workitem_complete_notes_hint')}</p>
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
