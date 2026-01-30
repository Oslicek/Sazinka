/**
 * Modal for importing customers from CSV file
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { useImport } from '../../services/import';
import { submitGeocodeAllPending } from '../../services/customerService';
import { useNatsStore } from '../../stores/natsStore';
import type { CreateCustomerRequest, ImportIssue } from '@shared/customer';
import styles from './ImportCustomersModal.module.css';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

interface ImportCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBatch?: (customers: CreateCustomerRequest[]) => Promise<{
    importedCount: number;
    updatedCount: number;
    errors: ImportIssue[];
  }>;
}

export function ImportCustomersModal({ 
  isOpen, 
  onClose,
  onImportBatch,
}: ImportCustomersModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState<'idle' | 'submitting' | 'submitted' | 'skipped' | 'error'>('idle');
  const [geocodeJobId, setGeocodeJobId] = useState<string | null>(null);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  
  const { state, startImport, reset } = useImport({
    onBatchReady: onImportBatch,
  });

  // Trigger geocoding when import completes
  useEffect(() => {
    if (state.status === 'complete' && geocodeStatus === 'idle') {
      setGeocodeStatus('submitting');
      
      submitGeocodeAllPending(USER_ID)
        .then((result) => {
          if (result) {
            setGeocodeJobId(result.jobId);
            setGeocodeStatus('submitted');
          } else {
            setGeocodeStatus('skipped'); // No customers to geocode - use 'skipped' to avoid loop
          }
        })
        .catch((err) => {
          setGeocodeError(err.message);
          setGeocodeStatus('error');
        });
    }
  }, [state.status, geocodeStatus]);

  const handleFileSelect = useCallback((file: File) => {
    if (file.name.endsWith('.csv') || file.type === 'text/csv') {
      startImport(file);
    } else {
      alert('Prosím vyberte soubor CSV.');
    }
  }, [startImport]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleCopyReport = useCallback(() => {
    if (state.textReport) {
      navigator.clipboard.writeText(state.textReport);
    }
  }, [state.textReport]);

  const handleSaveReport = useCallback(() => {
    if (state.textReport && state.report) {
      const blob = new Blob([state.textReport], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-report-${state.report.filename.replace('.csv', '')}-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [state.textReport, state.report]);

  const handleClose = useCallback(() => {
    reset();
    setGeocodeStatus('idle');
    setGeocodeJobId(null);
    setGeocodeError(null);
    onClose();
  }, [reset, onClose]);

  if (!isOpen) return null;

  const progressPercent = state.total > 0 
    ? Math.round((state.progress / state.total) * 100) 
    : 0;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Import zákazníků</h2>
          <button className={styles.closeButton} onClick={handleClose}>×</button>
        </div>

        <div className={styles.content}>
          {/* Idle state - file selection */}
          {state.status === 'idle' && (
            <div 
              className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className={styles.dropIcon}>📄</div>
              <p className={styles.dropText}>
                Přetáhněte CSV soubor sem
              </p>
              <p className={styles.dropHint}>
                nebo klikněte pro výběr souboru
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className={styles.fileInput}
              />
            </div>
          )}

          {/* Processing state */}
          {(state.status === 'processing' || state.status === 'sending') && (
            <div className={styles.processing}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>
                {state.status === 'processing' 
                  ? 'Zpracovávám CSV...' 
                  : 'Ukládám zákazníky...'}
              </p>
              <div className={styles.progressBar}>
                <div 
                  className={styles.progressFill} 
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className={styles.progressText}>
                {state.progress.toLocaleString('cs-CZ')} / {state.total.toLocaleString('cs-CZ')} ({progressPercent}%)
              </p>
            </div>
          )}

          {/* Error state */}
          {state.status === 'error' && (
            <div className={styles.error}>
              <div className={styles.errorIcon}>❌</div>
              <p className={styles.errorText}>{state.error}</p>
              <button className={styles.retryButton} onClick={reset}>
                Zkusit znovu
              </button>
            </div>
          )}

          {/* Complete state - report */}
          {state.status === 'complete' && state.report && (
            <div className={styles.complete}>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Celkem řádků</span>
                  <span className={styles.summaryValue}>
                    {state.report.totalRows.toLocaleString('cs-CZ')}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Importováno</span>
                  <span className={`${styles.summaryValue} ${styles.success}`}>
                    {state.report.importedCount.toLocaleString('cs-CZ')} ✓
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Aktualizováno</span>
                  <span className={styles.summaryValue}>
                    {state.report.updatedCount.toLocaleString('cs-CZ')} ↻
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Přeskočeno</span>
                  <span className={styles.summaryValue}>
                    {state.report.skippedCount.toLocaleString('cs-CZ')} ○
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Varování</span>
                  <span className={`${styles.summaryValue} ${state.report.issues.filter(i => i.level === 'warning').length > 0 ? styles.warning : ''}`}>
                    {state.report.issues.filter(i => i.level === 'warning').length}
                  </span>
                </div>
              </div>

              <div className={styles.reportSection}>
                <h3>Podrobný report</h3>
                <pre className={styles.reportText}>{state.textReport}</pre>
              </div>

              <div className={styles.reportActions}>
                <button className={styles.copyButton} onClick={handleCopyReport}>
                  📋 Kopírovat
                </button>
                <button className={styles.saveButton} onClick={handleSaveReport}>
                  💾 Uložit
                </button>
              </div>

              {/* Geocoding status */}
              <div className={styles.geocodeSection}>
                <h3>Geokódování adres</h3>
                {geocodeStatus === 'submitting' && (
                  <div className={styles.geocodeSubmitting}>
                    <div className={styles.spinner} />
                    <span>Odesílám úlohu geokódování...</span>
                  </div>
                )}
                {geocodeStatus === 'submitted' && (
                  <div className={styles.geocodeSubmitted}>
                    <span className={styles.successIcon}>✓</span>
                    <span>Geokódování spuštěno na pozadí</span>
                    {geocodeJobId && (
                      <small className={styles.jobId}>Job ID: {geocodeJobId.slice(0, 8)}...</small>
                    )}
                    <p className={styles.geocodeHint}>
                      Průběh můžete sledovat na stránce Admin.
                    </p>
                  </div>
                )}
                {geocodeStatus === 'error' && (
                  <div className={styles.geocodeError}>
                    <span className={styles.errorIcon}>⚠</span>
                    <span>Nepodařilo se spustit geokódování: {geocodeError}</span>
                  </div>
                )}
                {geocodeStatus === 'skipped' && (
                  <div className={styles.geocodeIdle}>
                    <span>Všichni zákazníci již mají souřadnice.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {state.status === 'complete' ? (
            <button className={styles.doneButton} onClick={handleClose}>
              Hotovo
            </button>
          ) : state.status === 'idle' ? (
            <a 
              href="/IMPORT_FORMAT.MD" 
              target="_blank" 
              rel="noopener noreferrer"
              className={styles.helpLink}
            >
              Nápověda k formátu CSV
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
