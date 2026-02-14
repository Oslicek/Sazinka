import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Visit, UpdateVisitRequest, CompleteVisitRequest } from '@shared/visit';
import { 
  updateVisit, 
  completeVisit,
  getVisitStatusLabel,
  getVisitTypeLabel,
  getVisitResultLabel,
} from '../../services/visitService';
import { useNatsStore } from '../../stores/natsStore';
import styles from './VisitDetailDialog.module.css';

interface VisitDetailDialogProps {
  visit: Visit;
  onClose: () => void;
  onSaved: () => void;
}

export function VisitDetailDialog({ 
  visit, 
  onClose, 
  onSaved 
}: VisitDetailDialogProps) {
  const { t } = useTranslation('pages');
  const isConnected = useNatsStore((s) => s.isConnected);
  
  const [formData, setFormData] = useState({
    scheduledDate: visit.scheduledDate,
    scheduledTimeStart: visit.scheduledTimeStart?.substring(0, 5) || '',
    scheduledTimeEnd: visit.scheduledTimeEnd?.substring(0, 5) || '',
    visitType: visit.visitType,
    status: visit.status,
  });
  
  const [completeData, setCompleteData] = useState({
    result: visit.result || 'successful',
    resultNotes: visit.resultNotes || '',
    requiresFollowUp: visit.requiresFollowUp || false,
    followUpReason: visit.followUpReason || '',
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompleteForm, setShowCompleteForm] = useState(false);

  const isCompleted = visit.status === 'completed';
  const canComplete = !isCompleted && ['planned', 'in_progress'].includes(visit.status);

  const handleChange = useCallback((field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!isConnected) {
      setError(t('visit_error_connection'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const updateData: UpdateVisitRequest = {
        id: visit.id,
        scheduledDate: formData.scheduledDate !== visit.scheduledDate 
          ? formData.scheduledDate 
          : undefined,
        scheduledTimeStart: formData.scheduledTimeStart !== (visit.scheduledTimeStart?.substring(0, 5) || '')
          ? formData.scheduledTimeStart || null
          : undefined,
        scheduledTimeEnd: formData.scheduledTimeEnd !== (visit.scheduledTimeEnd?.substring(0, 5) || '')
          ? formData.scheduledTimeEnd || null
          : undefined,
        visitType: formData.visitType !== visit.visitType 
          ? formData.visitType as Visit['visitType']
          : undefined,
        status: formData.status !== visit.status 
          ? formData.status as Visit['status']
          : undefined,
      };

      // Only send if there are changes
      const hasChanges = Object.entries(updateData).some(([k, v]) => k !== 'id' && v !== undefined);
      if (hasChanges) {
        await updateVisit(updateData);
      }
      
      onSaved();
    } catch (err) {
      console.error('Failed to update visit:', err);
      setError(err instanceof Error ? err.message : t('visit_error_save'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, visit, onSaved]);

  const handleComplete = useCallback(async () => {
    if (!isConnected) {
      setError(t('visit_error_connection'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const data: CompleteVisitRequest = {
        id: visit.id,
        result: completeData.result as Visit['result'] & string,
        resultNotes: completeData.resultNotes || undefined,
        requiresFollowUp: completeData.requiresFollowUp,
        followUpReason: completeData.requiresFollowUp ? completeData.followUpReason || undefined : undefined,
      };

      await completeVisit(data);
      onSaved();
    } catch (err) {
      console.error('Failed to complete visit:', err);
      setError(err instanceof Error ? err.message : t('visit_error_complete'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, completeData, visit.id, onSaved]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>{t('visit_detail_dialog_title')}</h3>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.content}>
          {/* Status badge */}
          <div className={styles.statusRow}>
            <span className={`${styles.statusBadge} ${styles[`status-${visit.status}`]}`}>
              {getVisitStatusLabel(visit.status)}
            </span>
            <span className={styles.typeBadge}>
              {getVisitTypeLabel(visit.visitType)}
            </span>
            {visit.result && (
              <span className={styles.resultBadge}>
                {getVisitResultLabel(visit.result)}
              </span>
            )}
          </div>

          {/* Customer info */}
          {visit.customerName && (
            <div className={styles.customerInfo}>
              <strong>{visit.customerName}</strong>
              {visit.customerStreet && <span>{visit.customerStreet}</span>}
              {visit.customerCity && <span>{visit.customerCity}</span>}
            </div>
          )}

          {/* Form fields */}
          <div className={styles.field}>
            <label>Datum</label>
            <input
              type="date"
              value={formData.scheduledDate}
              onChange={(e) => handleChange('scheduledDate', e.target.value)}
              disabled={isSubmitting || isCompleted}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>{t('visit_time_from')}</label>
              <input
                type="time"
                value={formData.scheduledTimeStart}
                onChange={(e) => handleChange('scheduledTimeStart', e.target.value)}
                disabled={isSubmitting || isCompleted}
              />
            </div>
            <div className={styles.field}>
              <label>{t('visit_time_to')}</label>
              <input
                type="time"
                value={formData.scheduledTimeEnd}
                onChange={(e) => handleChange('scheduledTimeEnd', e.target.value)}
                disabled={isSubmitting || isCompleted}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label>{t('visit_type')}</label>
            <select
              value={formData.visitType}
              onChange={(e) => handleChange('visitType', e.target.value)}
              disabled={isSubmitting || isCompleted}
            >
              <option value="consultation">Konzultace</option>
              <option value="installation">Instalace</option>
              <option value="repair">Oprava</option>
              <option value="follow_up">{t('visit_follow_up_visit')}</option>
              <option value="revision">Revize</option>
            </select>
          </div>

          {!isCompleted && (
            <div className={styles.field}>
              <label>{t('visit_status')}</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                disabled={isSubmitting}
              >
                <option value="planned">{t('visit_status_planned')}</option>
                <option value="in_progress">{t('visit_status_in_progress')}</option>
                <option value="cancelled">{t('visit_status_cancelled')}</option>
                <option value="rescheduled">{t('visit_result_rescheduled')}</option>
              </select>
            </div>
          )}

          {/* Complete visit section */}
          {canComplete && (
            <div className={styles.completeSection}>
              {!showCompleteForm ? (
                <button
                  type="button"
                  className={styles.completeButton}
                  onClick={() => setShowCompleteForm(true)}
                >
                  {t('visit_mark_complete')}
                </button>
              ) : (
                <div className={styles.completeForm}>
                  <h4>{t('visit_complete_dialog_title')}</h4>
                  
                  <div className={styles.field}>
                    <label>{t('visit_complete_result')}</label>
                    <select
                      value={completeData.result}
                      onChange={(e) => setCompleteData({ ...completeData, result: e.target.value as Visit['result'] & string })}
                      disabled={isSubmitting}
                    >
                      <option value="successful">{t('visit_result_successful')}</option>
                      <option value="partial">{t('visit_result_partial')}</option>
                      <option value="failed">{t('visit_result_failed')}</option>
                      <option value="customer_absent">{t('visit_result_customer_absent')}</option>
                      <option value="rescheduled">{t('visit_result_rescheduled')}</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label>{t('visit_result_note')}</label>
                    <textarea
                      rows={2}
                      value={completeData.resultNotes}
                      onChange={(e) => setCompleteData({ ...completeData, resultNotes: e.target.value })}
                      disabled={isSubmitting}
                      placeholder={t('visit_optional_note_placeholder')}
                    />
                  </div>

                  <div className={styles.checkboxField}>
                    <label>
                      <input
                        type="checkbox"
                        checked={completeData.requiresFollowUp}
                        onChange={(e) => setCompleteData({ ...completeData, requiresFollowUp: e.target.checked })}
                        disabled={isSubmitting}
                      />
                      {t('visit_complete_follow_up')}
                    </label>
                  </div>

                  {completeData.requiresFollowUp && (
                    <div className={styles.field}>
                      <label>{t('visit_complete_follow_up_reason')}</label>
                      <input
                        type="text"
                        value={completeData.followUpReason}
                        onChange={(e) => setCompleteData({ ...completeData, followUpReason: e.target.value })}
                        disabled={isSubmitting}
                        placeholder={t('visit_complete_follow_up_placeholder')}
                      />
                    </div>
                  )}

                  <div className={styles.completeActions}>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => setShowCompleteForm(false)}
                      disabled={isSubmitting}
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="button"
                      className={styles.confirmCompleteButton}
                      onClick={handleComplete}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? t('settings:saving') : t('visit_complete_dialog_title')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed info */}
          {isCompleted && (
            <div className={styles.completedInfo}>
              {visit.result && (
                <p><strong>{t('visit_result')}:</strong> {getVisitResultLabel(visit.result)}</p>
              )}
              {visit.resultNotes && (
                <p><strong>{t('visit_note_label')}</strong> {visit.resultNotes}</p>
              )}
              {visit.requiresFollowUp && (
                <p className={styles.followUp}>
                  <strong>{t('visit_complete_follow_up')}</strong>
                  {visit.followUpReason && <span>: {visit.followUpReason}</span>}
                </p>
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t('common:close')}
          </button>
          {!isCompleted && (
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSave}
              disabled={isSubmitting || !isConnected}
            >
              {isSubmitting ? t('settings:saving') : t('settings:save_changes')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
