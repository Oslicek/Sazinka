import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Revision, RevisionResult } from '@shared/revision';
import { REVISION_RESULT_KEYS } from '@shared/revision';
import { completeRevision, type CompleteRevisionRequest } from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import styles from './CompleteRevisionDialog.module.css';

interface CompleteRevisionDialogProps {
  revision: Revision;
  onSuccess: () => void;
  onCancel: () => void;
}

const RESULTS: RevisionResult[] = ['passed', 'failed', 'conditional'];

export function CompleteRevisionDialog({ revision, onSuccess, onCancel }: CompleteRevisionDialogProps) {
  const { t } = useTranslation('common');
  const [result, setResult] = useState<RevisionResult>('passed');
  const [findings, setFindings] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isConnected = useNatsStore((s) => s.isConnected);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected) {
      setError(t('errors.not_connected'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const data: CompleteRevisionRequest = {
        id: revision.id,
        result,
        findings: findings.trim() || undefined,
        durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
      };
      
      await completeRevision(data);
      onSuccess();
    } catch (err) {
      console.error('Failed to complete revision:', err);
      setError(err instanceof Error ? err.message : t('errors.revision_complete_failed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, revision.id, result, findings, durationMinutes, onSuccess]);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <h3 className={styles.title}>{t('revision_complete_title')}</h3>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.field}>
            <label className={styles.label}>
              {t('revision_result_label')} <span className={styles.required}>*</span>
            </label>
            <div className={styles.resultOptions}>
              {RESULTS.map((r) => (
                <label 
                  key={r} 
                  className={`${styles.resultOption} ${result === r ? styles.resultSelected : ''} ${styles[`result-${r}`]}`}
                >
                  <input
                    type="radio"
                    name="result"
                    value={r}
                    checked={result === r}
                    onChange={() => setResult(r)}
                    disabled={isSubmitting}
                  />
                  <span className={styles.resultLabel}>{t(REVISION_RESULT_KEYS[r])}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="durationMinutes" className={styles.label}>
              {t('revision_duration_label')}
            </label>
            <input
              type="number"
              id="durationMinutes"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 0)}
              className={styles.input}
              min={0}
              max={480}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="findings" className={styles.label}>
              {t('revision_findings_label')}
            </label>
            <textarea
              id="findings"
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              className={styles.textarea}
              placeholder={t('revision_findings_placeholder')}
              rows={4}
              disabled={isSubmitting}
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
              {isSubmitting ? t('saving') : t('revision_complete_title')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
