import { useState, useCallback } from 'react';
import type { Revision, RevisionResult } from '@shared/revision';
import { REVISION_RESULT_LABELS } from '@shared/revision';
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
  const [result, setResult] = useState<RevisionResult>('passed');
  const [findings, setFindings] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isConnected = useNatsStore((s) => s.isConnected);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected) {
      setError('Není připojení k serveru');
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit revizi');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, revision.id, result, findings, durationMinutes, onSuccess]);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <h3 className={styles.title}>Dokončit revizi</h3>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.field}>
            <label className={styles.label}>
              Výsledek revize <span className={styles.required}>*</span>
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
                  <span className={styles.resultLabel}>{REVISION_RESULT_LABELS[r]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="durationMinutes" className={styles.label}>
              Doba trvání (minuty)
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
              Zjištění / Poznámky
            </label>
            <textarea
              id="findings"
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              className={styles.textarea}
              placeholder="Popište zjištění z revize..."
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
              Zrušit
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={isSubmitting || !isConnected}
            >
              {isSubmitting ? 'Ukládám...' : 'Dokončit revizi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
