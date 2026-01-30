import { useState, useCallback } from 'react';
import type { Revision } from '@shared/revision';
import { REVISION_STATUS_LABELS, REVISION_RESULT_LABELS } from '@shared/revision';
import { 
  updateRevision, 
  completeRevision,
  type UpdateRevisionRequest,
  type CompleteRevisionRequest,
} from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import styles from './RevisionDetailDialog.module.css';

interface RevisionDetailDialogProps {
  revision: Revision;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function RevisionDetailDialog({ 
  revision, 
  userId, 
  onClose, 
  onSaved 
}: RevisionDetailDialogProps) {
  const isConnected = useNatsStore((s) => s.isConnected);
  
  const [formData, setFormData] = useState({
    dueDate: revision.dueDate,
    scheduledDate: revision.scheduledDate || '',
    scheduledTimeStart: revision.scheduledTimeStart?.substring(0, 5) || '',
    scheduledTimeEnd: revision.scheduledTimeEnd?.substring(0, 5) || '',
    findings: revision.findings || '',
    status: revision.status,
  });
  
  const [completeData, setCompleteData] = useState({
    result: revision.result || 'passed',
    durationMinutes: revision.durationMinutes?.toString() || '',
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompleteForm, setShowCompleteForm] = useState(false);

  const isCompleted = revision.status === 'completed';
  const canComplete = !isCompleted && ['scheduled', 'confirmed', 'upcoming', 'due_soon', 'overdue'].includes(revision.status);

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

      const updateData: UpdateRevisionRequest = {
        id: revision.id,
        dueDate: formData.dueDate !== revision.dueDate ? formData.dueDate : undefined,
        scheduledDate: formData.scheduledDate !== (revision.scheduledDate || '') 
          ? formData.scheduledDate || undefined 
          : undefined,
        scheduledTimeStart: formData.scheduledTimeStart !== (revision.scheduledTimeStart?.substring(0, 5) || '')
          ? formData.scheduledTimeStart || undefined
          : undefined,
        scheduledTimeEnd: formData.scheduledTimeEnd !== (revision.scheduledTimeEnd?.substring(0, 5) || '')
          ? formData.scheduledTimeEnd || undefined
          : undefined,
        status: formData.status !== revision.status ? formData.status : undefined,
      };

      // Only send if there are changes
      const hasChanges = Object.values(updateData).some(v => v !== undefined && v !== revision.id);
      if (hasChanges) {
        await updateRevision(userId, updateData);
      }
      
      onSaved();
    } catch (err) {
      console.error('Failed to update revision:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se uložit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, revision, userId, onSaved]);

  const handleComplete = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const data: CompleteRevisionRequest = {
        id: revision.id,
        result: completeData.result,
        findings: formData.findings || undefined,
        durationMinutes: completeData.durationMinutes 
          ? parseInt(completeData.durationMinutes, 10) 
          : undefined,
      };

      await completeRevision(userId, data);
      onSaved();
    } catch (err) {
      console.error('Failed to complete revision:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, completeData, formData.findings, revision.id, userId, onSaved]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Detail revize</h3>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.content}>
          {/* Status badge */}
          <div className={styles.statusRow}>
            <span className={`${styles.statusBadge} ${styles[`status-${revision.status}`]}`}>
              {REVISION_STATUS_LABELS[revision.status as keyof typeof REVISION_STATUS_LABELS] || revision.status}
            </span>
            {revision.result && (
              <span className={styles.resultBadge}>
                Výsledek: {REVISION_RESULT_LABELS[revision.result as keyof typeof REVISION_RESULT_LABELS] || revision.result}
              </span>
            )}
          </div>

          {/* Form fields */}
          <div className={styles.field}>
            <label>Termín revize</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={(e) => handleChange('dueDate', e.target.value)}
              disabled={isSubmitting || isCompleted}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>Naplánované datum</label>
              <input
                type="date"
                value={formData.scheduledDate}
                onChange={(e) => handleChange('scheduledDate', e.target.value)}
                disabled={isSubmitting || isCompleted}
              />
            </div>
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
            <label>Poznámka</label>
            <textarea
              rows={3}
              value={formData.findings}
              onChange={(e) => handleChange('findings', e.target.value)}
              disabled={isSubmitting}
              placeholder="Poznámky k revizi..."
            />
          </div>

          {/* Complete revision section */}
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
                  <h4>Dokončit revizi</h4>
                  
                  <div className={styles.field}>
                    <label>Výsledek *</label>
                    <select
                      value={completeData.result}
                      onChange={(e) => setCompleteData({ ...completeData, result: e.target.value })}
                      disabled={isSubmitting}
                    >
                      <option value="passed">V pořádku</option>
                      <option value="conditional">S výhradami</option>
                      <option value="failed">Nevyhovělo</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label>Délka trvání (minuty)</label>
                    <input
                      type="number"
                      value={completeData.durationMinutes}
                      onChange={(e) => setCompleteData({ ...completeData, durationMinutes: e.target.value })}
                      disabled={isSubmitting}
                      placeholder="např. 60"
                      min="1"
                    />
                  </div>

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
                      {isSubmitting ? 'Ukládám...' : 'Dokončit revizi'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed info */}
          {isCompleted && revision.completedAt && (
            <div className={styles.completedInfo}>
              <p>
                <strong>Dokončeno:</strong>{' '}
                {new Date(revision.completedAt).toLocaleString('cs-CZ')}
              </p>
              {revision.durationMinutes && (
                <p><strong>Trvání:</strong> {revision.durationMinutes} min</p>
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
