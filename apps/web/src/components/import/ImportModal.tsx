/**
 * Universal Modal for importing entities from CSV files
 * Supports: customers, devices, revisions, communications, visits
 */

import { useCallback, useRef, useState } from 'react';
import type { ImportIssue, ImportReport } from '@shared/customer';
import type {
  ImportDeviceRequest,
  ImportRevisionRequest,
  ImportCommunicationRequest,
  ImportVisitRequest,
} from '@shared/import';
import {
  processDeviceCsv,
  processRevisionCsv,
  processCommunicationCsv,
  processVisitCsv,
  generateTextReport,
} from '../../services/import';
import {
  importDevicesBatch,
  importRevisionsBatch,
  importCommunicationsBatch,
  importVisitsBatch,
} from '../../services/import/importBatchService';
import styles from './ImportModal.module.css';

export type ImportEntityType = 'device' | 'revision' | 'communication' | 'visit';

const ENTITY_LABELS: Record<ImportEntityType, string> = {
  device: 'zařízení',
  revision: 'revizí',
  communication: 'komunikace',
  visit: 'návštěv',
};

const ENTITY_TITLES: Record<ImportEntityType, string> = {
  device: 'Import zařízení',
  revision: 'Import revizí',
  communication: 'Import komunikace',
  visit: 'Import návštěv',
};

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: ImportEntityType;
  onComplete?: () => void;
}

type ImportStatus = 'idle' | 'parsing' | 'sending' | 'complete' | 'error';

export function ImportModal({ isOpen, onClose, entityType, onComplete }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [textReport, setTextReport] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setTotal(0);
    setError(null);
    setReport(null);
    setTextReport(null);
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      alert('Prosím vyberte soubor CSV.');
      return;
    }

    reset();
    setStatus('parsing');

    try {
      const csvContent = await file.text();
      const startTime = Date.now();

      let parsedEntities: any[] = [];
      let parsingIssues: ImportIssue[] = [];
      let totalRows = 0;
      let skippedCount = 0;

      // Parse based on entity type
      switch (entityType) {
        case 'device': {
          const result = processDeviceCsv(csvContent);
          parsedEntities = result.devices;
          parsingIssues = result.issues;
          totalRows = result.totalRows;
          skippedCount = result.skippedCount;
          break;
        }
        case 'revision': {
          const result = processRevisionCsv(csvContent);
          parsedEntities = result.revisions;
          parsingIssues = result.issues;
          totalRows = result.totalRows;
          skippedCount = result.skippedCount;
          break;
        }
        case 'communication': {
          const result = processCommunicationCsv(csvContent);
          parsedEntities = result.communications;
          parsingIssues = result.issues;
          totalRows = result.totalRows;
          skippedCount = result.skippedCount;
          break;
        }
        case 'visit': {
          const result = processVisitCsv(csvContent);
          parsedEntities = result.visits;
          parsingIssues = result.issues;
          totalRows = result.totalRows;
          skippedCount = result.skippedCount;
          break;
        }
      }

      if (parsedEntities.length === 0) {
        setStatus('error');
        setError('Soubor neobsahuje žádná validní data.');
        return;
      }

      // Send to backend
      setStatus('sending');
      setTotal(parsedEntities.length);
      setProgress(0);

      let importedCount = 0;
      let updatedCount = 0;
      const allIssues = [...parsingIssues];

      // Send in batches
      const batchSize = 100;
      for (let i = 0; i < parsedEntities.length; i += batchSize) {
        const batch = parsedEntities.slice(i, i + batchSize);

        try {
          let response;
          switch (entityType) {
            case 'device':
              response = await importDevicesBatch(batch as ImportDeviceRequest[]);
              break;
            case 'revision':
              response = await importRevisionsBatch(batch as ImportRevisionRequest[]);
              break;
            case 'communication':
              response = await importCommunicationsBatch(batch as ImportCommunicationRequest[]);
              break;
            case 'visit':
              response = await importVisitsBatch(batch as ImportVisitRequest[]);
              break;
          }

          if (response) {
            importedCount += response.importedCount;
            updatedCount += response.updatedCount;
            response.errors.forEach(err => {
              allIssues.push({
                rowNumber: err.rowNumber,
                level: 'error',
                field: err.field,
                message: err.message,
                originalValue: err.originalValue,
              });
            });
          }
        } catch (e) {
          allIssues.push({
            rowNumber: i + 2,
            level: 'error',
            field: 'server',
            message: e instanceof Error ? e.message : 'Chyba serveru',
          });
        }

        setProgress(Math.min(i + batchSize, parsedEntities.length));
      }

      const durationMs = Date.now() - startTime;

      // Generate report
      const finalReport: ImportReport = {
        filename: file.name,
        importedAt: new Date().toISOString(),
        durationMs,
        totalRows,
        importedCount,
        updatedCount,
        skippedCount: skippedCount + (totalRows - importedCount - updatedCount - skippedCount),
        issues: allIssues,
      };

      setReport(finalReport);
      setTextReport(generateTextReport(finalReport));
      setStatus('complete');
      
      if (onComplete) {
        onComplete();
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Neočekávaná chyba');
    }
  }, [entityType, reset, onComplete]);

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
    if (textReport) {
      navigator.clipboard.writeText(textReport);
    }
  }, [textReport]);

  const handleSaveReport = useCallback(() => {
    if (textReport && report) {
      const blob = new Blob([textReport], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-${entityType}-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [textReport, report, entityType]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!isOpen) return null;

  const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{ENTITY_TITLES[entityType]}</h2>
          <button className={styles.closeButton} onClick={handleClose}>×</button>
        </div>

        <div className={styles.content}>
          {/* Idle state - file selection */}
          {status === 'idle' && (
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
          {(status === 'parsing' || status === 'sending') && (
            <div className={styles.processing}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>
                {status === 'parsing'
                  ? 'Zpracovávám CSV...'
                  : `Ukládám ${ENTITY_LABELS[entityType]}...`}
              </p>
              {status === 'sending' && (
                <>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className={styles.progressText}>
                    {progress.toLocaleString('cs-CZ')} / {total.toLocaleString('cs-CZ')} ({progressPercent}%)
                  </p>
                </>
              )}
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className={styles.error}>
              <div className={styles.errorIcon}>❌</div>
              <p className={styles.errorText}>{error}</p>
              <button className={styles.retryButton} onClick={reset}>
                Zkusit znovu
              </button>
            </div>
          )}

          {/* Complete state - report */}
          {status === 'complete' && report && (
            <div className={styles.complete}>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Celkem řádků</span>
                  <span className={styles.summaryValue}>
                    {report.totalRows.toLocaleString('cs-CZ')}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Importováno</span>
                  <span className={`${styles.summaryValue} ${styles.success}`}>
                    {report.importedCount.toLocaleString('cs-CZ')} ✓
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Aktualizováno</span>
                  <span className={styles.summaryValue}>
                    {report.updatedCount.toLocaleString('cs-CZ')} ↻
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Přeskočeno</span>
                  <span className={styles.summaryValue}>
                    {report.skippedCount.toLocaleString('cs-CZ')} ○
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Chyby</span>
                  <span className={`${styles.summaryValue} ${report.issues.filter(i => i.level === 'error').length > 0 ? styles.warning : ''}`}>
                    {report.issues.filter(i => i.level === 'error').length}
                  </span>
                </div>
              </div>

              <div className={styles.reportSection}>
                <h3>Podrobný report</h3>
                <pre className={styles.reportText}>{textReport}</pre>
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
          {status === 'complete' ? (
            <button className={styles.doneButton} onClick={handleClose}>
              Hotovo
            </button>
          ) : status === 'idle' ? (
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
