import { useState, useCallback } from 'react';
import type { Visit, UpdateVisitRequest, CompleteVisitRequest } from '@sazinka/shared-types';
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
      setError('Není připojení k serveru');
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se uložit návštěvu');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, visit, onSaved]);

  const handleComplete = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit návštěvu');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, completeData, visit.id, onSaved]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Detail návštěvy</h3>
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
              <label>Čas od</label>
              <input
                type="time"
                value={formData.scheduledTimeStart}
                onChange={(e) => handleChange('scheduledTimeStart', e.target.value)}
                disabled={isSubmitting || isCompleted}
              />
            </div>
            <div className={styles.field}>
              <label>Čas do</label>
              <input
                type="time"
                value={formData.scheduledTimeEnd}
                onChange={(e) => handleChange('scheduledTimeEnd', e.target.value)}
                disabled={isSubmitting || isCompleted}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label>Typ návštěvy</label>
            <select
              value={formData.visitType}
              onChange={(e) => handleChange('visitType', e.target.value)}
              disabled={isSubmitting || isCompleted}
            >
              <option value="consultation">Konzultace</option>
              <option value="installation">Instalace</option>
              <option value="repair">Oprava</option>
              <option value="follow_up">Následná návštěva</option>
              <option value="revision">Revize</option>
            </select>
          </div>

          {!isCompleted && (
            <div className={styles.field}>
              <label>Stav</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                disabled={isSubmitting}
              >
                <option value="planned">Naplánováno</option>
                <option value="in_progress">Probíhá</option>
                <option value="cancelled">Zrušeno</option>
                <option value="rescheduled">Přeplánováno</option>
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
                  ✓ Označit jako dokončenou
                </button>
              ) : (
                <div className={styles.completeForm}>
                  <h4>Dokončit návštěvu</h4>
                  
                  <div className={styles.field}>
                    <label>Výsledek *</label>
                    <select
                      value={completeData.result}
                      onChange={(e) => setCompleteData({ ...completeData, result: e.target.value })}
                      disabled={isSubmitting}
                    >
                      <option value="successful">Úspěšná</option>
                      <option value="partial">Částečná</option>
                      <option value="failed">Neúspěšná</option>
                      <option value="customer_absent">Zákazník nepřítomen</option>
                      <option value="rescheduled">Přeplánováno</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label>Poznámka k výsledku</label>
                    <textarea
                      rows={2}
                      value={completeData.resultNotes}
                      onChange={(e) => setCompleteData({ ...completeData, resultNotes: e.target.value })}
                      disabled={isSubmitting}
                      placeholder="Volitelná poznámka..."
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
                      Vyžaduje následnou návštěvu
                    </label>
                  </div>

                  {completeData.requiresFollowUp && (
                    <div className={styles.field}>
                      <label>Důvod následné návštěvy</label>
                      <input
                        type="text"
                        value={completeData.followUpReason}
                        onChange={(e) => setCompleteData({ ...completeData, followUpReason: e.target.value })}
                        disabled={isSubmitting}
                        placeholder="Proč je potřeba další návštěva..."
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
                      Zrušit
                    </button>
                    <button
                      type="button"
                      className={styles.confirmCompleteButton}
                      onClick={handleComplete}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Ukládám...' : 'Dokončit návštěvu'}
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
                <p><strong>Výsledek:</strong> {getVisitResultLabel(visit.result)}</p>
              )}
              {visit.resultNotes && (
                <p><strong>Poznámka:</strong> {visit.resultNotes}</p>
              )}
              {visit.requiresFollowUp && (
                <p className={styles.followUp}>
                  <strong>Vyžaduje následnou návštěvu</strong>
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
            Zavřít
          </button>
          {!isCompleted && (
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSave}
              disabled={isSubmitting || !isConnected}
            >
              {isSubmitting ? 'Ukládám...' : 'Uložit změny'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
