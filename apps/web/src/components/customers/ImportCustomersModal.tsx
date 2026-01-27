/**
 * Modal for importing customers from CSV file
 */

import { useCallback, useRef, useState } from 'react';
import { useImport } from '../../services/import';
import type { CreateCustomerRequest, ImportIssue } from '@shared/customer';
import styles from './ImportCustomersModal.module.css';

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
  
  const { state, startImport, reset } = useImport({
    onBatchReady: onImportBatch,
  });

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
