import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Revision } from '@shared/revision';
import { 
  createRevision, 
  updateRevision,
  type CreateRevisionRequest,
  type UpdateRevisionRequest 
} from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import { TimeInput } from '../common/TimeInput';
import styles from './RevisionForm.module.css';

interface RevisionFormProps {
  customerId?: string;
  deviceId?: string;
  revision?: Revision;
  onSuccess: () => void;
  onCancel: () => void;
}

interface FormData {
  dueDate: string;
  scheduledDate: string;
  scheduledTimeStart: string;
  scheduledTimeEnd: string;
  status: string;
  findings: string;
}

const STATUS_VALUES = ['upcoming', 'scheduled', 'confirmed'] as const;

const createInitialFormData = (revision?: Revision): FormData => ({
  dueDate: revision?.dueDate ?? '',
  scheduledDate: revision?.scheduledDate ?? '',
  scheduledTimeStart: revision?.scheduledTimeStart?.substring(0, 5) ?? '',
  scheduledTimeEnd: revision?.scheduledTimeEnd?.substring(0, 5) ?? '',
  status: revision?.status ?? 'upcoming',
  findings: revision?.findings ?? '',
});

export function RevisionForm({ customerId, deviceId, revision, onSuccess, onCancel }: RevisionFormProps) {
  const { t } = useTranslation('common');
  const isEditMode = !!revision;
  const [formData, setFormData] = useState<FormData>(() => createInitialFormData(revision));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isConnected = useNatsStore((s) => s.isConnected);

  const handleChange = useCallback((field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected) {
      setError(t('errors.not_connected'));
      return;
    }

    // Validate required fields
    if (!formData.dueDate) {
      setError(t('revision_form_error_due_date'));
      return;
    }

    if (!isEditMode && (!customerId || !deviceId)) {
      setError(t('revision_form_error_missing_ids'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      if (isEditMode && revision) {
        const updateData: UpdateRevisionRequest = {
          id: revision.id,
          status: formData.status !== revision.status ? formData.status : undefined,
          dueDate: formData.dueDate !== revision.dueDate ? formData.dueDate : undefined,
          scheduledDate: formData.scheduledDate !== (revision.scheduledDate ?? '')
            ? formData.scheduledDate || undefined
            : undefined,
          scheduledTimeStart: formData.scheduledTimeStart !== (revision.scheduledTimeStart?.substring(0, 5) ?? '')
            ? formData.scheduledTimeStart || undefined
            : undefined,
          scheduledTimeEnd: formData.scheduledTimeEnd !== (revision.scheduledTimeEnd?.substring(0, 5) ?? '')
            ? formData.scheduledTimeEnd || undefined
            : undefined,
        };
        
        await updateRevision(updateData);
      } else {
        const createData: CreateRevisionRequest = {
          customerId: customerId!,
          deviceId: deviceId!,
          dueDate: formData.dueDate,
          scheduledDate: formData.scheduledDate || undefined,
          scheduledTimeStart: formData.scheduledTimeStart || undefined,
          scheduledTimeEnd: formData.scheduledTimeEnd || undefined,
          findings: formData.findings || undefined,
        };
        
        await createRevision(createData);
      }

      onSuccess();
    } catch (err) {
      console.error('Failed to save revision:', err);
      setError(err instanceof Error ? err.message : t('revision_form_error_save'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, isEditMode, revision, customerId, deviceId, onSuccess]);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h3 className={styles.title}>
        {isEditMode ? t('revision_form_edit') : t('revision_form_new')}
      </h3>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.field}>
        <label htmlFor="dueDate" className={styles.label}>
          {t('revision_form_due_date')} <span className={styles.required}>*</span>
        </label>
        <input
          type="date"
          id="dueDate"
          value={formData.dueDate}
          onChange={(e) => handleChange('dueDate', e.target.value)}
          className={styles.input}
          disabled={isSubmitting}
        />
      </div>

      {isEditMode && (
        <div className={styles.field}>
          <label htmlFor="status" className={styles.label}>{t('revision_form_status')}</label>
          <select
            id="status"
            value={formData.status}
            onChange={(e) => handleChange('status', e.target.value)}
            className={styles.select}
            disabled={isSubmitting}
          >
            {STATUS_VALUES.map((value) => (
              <option key={value} value={value}>{t(`revision_status.${value}`)}</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('revision_form_scheduling')}</h4>
        
        <div className={styles.field}>
          <label htmlFor="scheduledDate" className={styles.label}>{t('revision_form_scheduled_date')}</label>
          <input
            type="date"
            id="scheduledDate"
            value={formData.scheduledDate}
            onChange={(e) => handleChange('scheduledDate', e.target.value)}
            className={styles.input}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="scheduledTimeStart" className={styles.label}>{t('revision_form_time_from')}</label>
            <TimeInput
              id="scheduledTimeStart"
              value={formData.scheduledTimeStart}
              onChange={(v) => handleChange('scheduledTimeStart', v)}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="scheduledTimeEnd" className={styles.label}>{t('revision_form_time_to')}</label>
            <TimeInput
              id="scheduledTimeEnd"
              value={formData.scheduledTimeEnd}
              onChange={(v) => handleChange('scheduledTimeEnd', v)}
              disabled={isSubmitting}
            />
          </div>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="findings" className={styles.label}>{t('revision_form_note')}</label>
        <textarea
          id="findings"
          value={formData.findings}
          onChange={(e) => handleChange('findings', e.target.value)}
          className={styles.textarea}
          disabled={isSubmitting}
          rows={3}
          placeholder={t('revision_form_note_placeholder')}
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
          disabled={isSubmitting}
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting || !isConnected}
        >
          {isSubmitting ? t('saving') : (isEditMode ? t('revision_form_save_changes') : t('revision_form_create'))}
        </button>
      </div>
    </form>
  );
}
