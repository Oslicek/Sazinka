import { useState, useCallback } from 'react';
import type { Revision } from '@shared/revision';
import { 
  createRevision, 
  updateRevision,
  type CreateRevisionRequest,
  type UpdateRevisionRequest 
} from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import styles from './RevisionForm.module.css';

interface RevisionFormProps {
  customerId?: string;
  deviceId?: string;
  userId: string;
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

const STATUSES = [
  { value: 'upcoming', label: 'Nadcházející' },
  { value: 'scheduled', label: 'Naplánováno' },
  { value: 'confirmed', label: 'Potvrzeno' },
];

const createInitialFormData = (revision?: Revision): FormData => ({
  dueDate: revision?.dueDate ?? '',
  scheduledDate: revision?.scheduledDate ?? '',
  scheduledTimeStart: revision?.scheduledTimeStart?.substring(0, 5) ?? '',
  scheduledTimeEnd: revision?.scheduledTimeEnd?.substring(0, 5) ?? '',
  status: revision?.status ?? 'upcoming',
  findings: revision?.findings ?? '',
});

export function RevisionForm({ customerId, deviceId, userId, revision, onSuccess, onCancel }: RevisionFormProps) {
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
      setError('Není připojení k serveru');
      return;
    }

    // Validate required fields
    if (!formData.dueDate) {
      setError('Vyplňte termín revize');
      return;
    }

    if (!isEditMode && (!customerId || !deviceId)) {
      setError('Chybí ID zákazníka nebo zařízení');
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
        
        await updateRevision(userId, updateData);
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
        
        await createRevision(userId, createData);
      }

      onSuccess();
    } catch (err) {
      console.error('Failed to save revision:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se uložit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, isEditMode, revision, userId, customerId, deviceId, onSuccess]);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h3 className={styles.title}>
        {isEditMode ? 'Upravit revizi' : 'Nová revize'}
      </h3>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.field}>
        <label htmlFor="dueDate" className={styles.label}>
          Termín revize <span className={styles.required}>*</span>
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
          <label htmlFor="status" className={styles.label}>Stav</label>
          <select
            id="status"
            value={formData.status}
            onChange={(e) => handleChange('status', e.target.value)}
            className={styles.select}
            disabled={isSubmitting}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Plánování</h4>
        
        <div className={styles.field}>
          <label htmlFor="scheduledDate" className={styles.label}>Naplánované datum</label>
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
            <label htmlFor="scheduledTimeStart" className={styles.label}>Čas od</label>
            <input
              type="time"
              id="scheduledTimeStart"
              value={formData.scheduledTimeStart}
              onChange={(e) => handleChange('scheduledTimeStart', e.target.value)}
              className={styles.input}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="scheduledTimeEnd" className={styles.label}>Čas do</label>
            <input
              type="time"
              id="scheduledTimeEnd"
              value={formData.scheduledTimeEnd}
              onChange={(e) => handleChange('scheduledTimeEnd', e.target.value)}
              className={styles.input}
              disabled={isSubmitting}
            />
          </div>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="findings" className={styles.label}>Poznámka</label>
        <textarea
          id="findings"
          value={formData.findings}
          onChange={(e) => handleChange('findings', e.target.value)}
          className={styles.textarea}
          disabled={isSubmitting}
          rows={3}
          placeholder="Volitelná poznámka k revizi..."
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
          disabled={isSubmitting}
        >
          Zrušit
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting || !isConnected}
        >
          {isSubmitting ? 'Ukládám...' : (isEditMode ? 'Uložit změny' : 'Vytvořit revizi')}
        </button>
      </div>
    </form>
  );
}
