/**
 * Universal Modal for importing entities from CSV files
 * Supports: devices, revisions, communications, visits
 * Also supports ZIP files containing multiple CSV files
 * 
 * All imports are processed asynchronously via job queue.
 */

import { useCallback, useRef, useState } from 'react';
import {
  submitDeviceImportJob,
  submitRevisionImportJob,
  submitCommunicationImportJob,
  submitVisitImportJob,
  submitZipImportJob,
} from '../../services/importJobService';
import { useActiveJobsStore } from '../../stores/activeJobsStore';
import type { JobType } from '../../stores/activeJobsStore';
import styles from './ImportModal.module.css';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

export type ImportEntityType = 'device' | 'revision' | 'communication' | 'visit' | 'zip';

const ENTITY_LABELS: Record<ImportEntityType, string> = {
  device: 'zařízení',
  revision: 'revizí',
  communication: 'komunikace',
  visit: 'návštěv',
  zip: 'souborů',
};

const ENTITY_TITLES: Record<ImportEntityType, string> = {
  device: 'Import zařízení',
  revision: 'Import revizí',
  communication: 'Import komunikace',
  visit: 'Import návštěv',
  zip: 'Import ZIP',
};

const JOB_TYPES: Record<ImportEntityType, JobType> = {
  device: 'import.device',
  revision: 'import.revision',
  communication: 'import.communication',
  visit: 'import.visit',
  zip: 'import.zip',
};

const ACCEPTED_FILES: Record<ImportEntityType, string> = {
  device: '.csv,text/csv',
  revision: '.csv,text/csv',
  communication: '.csv,text/csv',
  visit: '.csv,text/csv',
  zip: '.zip,application/zip,application/x-zip-compressed',
};

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: ImportEntityType;
  onComplete?: () => void;
}

type ModalState = 'idle' | 'parsing' | 'preview' | 'submitting' | 'submitted' | 'error';

interface FilePreview {
  filename: string;
  totalRows?: number;       // For CSV files
  sampleRows?: string[][];  // For CSV files
  headers?: string[];       // For CSV files
  fileSize: number;
  content: string;          // Raw content (text for CSV, base64 for ZIP)
  isZip: boolean;
}

export function ImportModal({ isOpen, onClose, entityType, onComplete }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<ModalState>('idle');
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);

  const addJob = useActiveJobsStore((s) => s.addJob);

  const parseCSVPreview = useCallback(async (file: File): Promise<FilePreview> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split(/\r?\n/).filter(line => line.trim());

          if (lines.length < 2) {
            reject(new Error('CSV soubor musí obsahovat alespoň hlavičku a jeden řádek dat'));
            return;
          }

          // Parse using semicolon delimiter (Czech format)
          const delimiter = text.includes(';') ? ';' : ',';
          const parseLine = (line: string) => {
            const result: string[] = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            result.push(current.trim());
            return result;
          };

          const headers = parseLine(lines[0]);
          const sampleRows = lines.slice(1, 6).map(parseLine); // First 5 data rows
          const totalRows = lines.length - 1; // Excluding header

          resolve({
            filename: file.name,
            totalRows,
            sampleRows,
            headers,
            fileSize: file.size,
            content: text,
            isZip: false,
          });
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('Nepodařilo se načíst soubor'));
      reader.readAsText(file, 'utf-8');
    });
  }, []);

  const parseZipPreview = useCallback(async (file: File): Promise<FilePreview> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );

          resolve({
            filename: file.name,
            fileSize: file.size,
            content: base64,
            isZip: true,
          });
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('Nepodařilo se načíst ZIP soubor'));
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    const isZip = file.name.endsWith('.zip') || file.type.includes('zip');
    const expectsZip = entityType === 'zip';

    if (expectsZip && !isZip) {
      setError('Prosím vyberte soubor ZIP.');
      setState('error');
      return;
    }

    if (!expectsZip && isZip) {
      setError('Prosím vyberte soubor CSV, ne ZIP.');
      setState('error');
      return;
    }

    if (!expectsZip && !file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setError('Prosím vyberte soubor CSV.');
      setState('error');
      return;
    }

    setState('parsing');
    setError(null);

    try {
      let filePreview: FilePreview;
      
      if (isZip) {
        filePreview = await parseZipPreview(file);
      } else {
        filePreview = await parseCSVPreview(file);
      }

      setPreview(filePreview);
      setState('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se zpracovat soubor');
      setState('error');
    }
  }, [entityType, parseCSVPreview, parseZipPreview]);

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

  const handleSubmitImport = useCallback(async () => {
    if (!preview) return;

    setState('submitting');
    setError(null);

    try {
      let result: { jobId: string; message: string };

      switch (entityType) {
        case 'device':
          result = await submitDeviceImportJob(USER_ID, preview.content, preview.filename);
          break;
        case 'revision':
          result = await submitRevisionImportJob(USER_ID, preview.content, preview.filename);
          break;
        case 'communication':
          result = await submitCommunicationImportJob(USER_ID, preview.content, preview.filename);
          break;
        case 'visit':
          result = await submitVisitImportJob(USER_ID, preview.content, preview.filename);
          break;
        case 'zip':
          result = await submitZipImportJob(USER_ID, preview.content, preview.filename);
          break;
        default:
          throw new Error(`Nepodporovaný typ importu: ${entityType}`);
      }

      // Add job to active jobs store for immediate tracking
      addJob({
        id: result.jobId,
        type: JOB_TYPES[entityType],
        name: `Import: ${preview.filename}`,
        status: 'queued',
        progressText: 'Čeká ve frontě...',
        startedAt: new Date(),
      });

      setSubmittedJobId(result.jobId);
      setState('submitted');

      // Notify parent component
      if (onComplete) {
        onComplete();
      }

      // Close modal after a brief moment to show success
      setTimeout(() => {
        handleClose();
      }, 1500);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se spustit import');
      setState('error');
    }
  }, [preview, entityType, addJob, onComplete]);

  const handleClose = useCallback(() => {
    setState('idle');
    setPreview(null);
    setError(null);
    setSubmittedJobId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  }, [onClose]);

  const handleReset = useCallback(() => {
    setState('idle');
    setPreview(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  if (!isOpen) return null;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{ENTITY_TITLES[entityType]}</h2>
          <button className={styles.closeButton} onClick={handleClose}>×</button>
        </div>

        <div className={styles.content}>
          {/* Idle state - file selection */}
          {state === 'idle' && (
            <div
              className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className={styles.dropIcon}>{entityType === 'zip' ? '📦' : '📄'}</div>
              <p className={styles.dropText}>
                Přetáhněte {entityType === 'zip' ? 'ZIP' : 'CSV'} soubor sem
              </p>
              <p className={styles.dropHint}>
                nebo klikněte pro výběr souboru
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILES[entityType]}
                onChange={handleFileChange}
                className={styles.fileInput}
              />
            </div>
          )}

          {/* Parsing state */}
          {state === 'parsing' && (
            <div className={styles.processing}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>Načítám soubor...</p>
            </div>
          )}

          {/* Preview state */}
          {state === 'preview' && preview && (
            <div className={styles.previewContainer}>
              <div className={styles.previewHeader}>
                <div className={styles.previewInfo}>
                  <span className={styles.filename}>{preview.filename}</span>
                  <span className={styles.fileSize}>{formatFileSize(preview.fileSize)}</span>
                  {preview.totalRows && (
                    <span className={styles.rowCount}>
                      {preview.totalRows.toLocaleString('cs-CZ')} {ENTITY_LABELS[entityType]}
                    </span>
                  )}
                </div>
              </div>

              {/* CSV preview table */}
              {!preview.isZip && preview.headers && preview.sampleRows && (
                <div className={styles.previewTable}>
                  <table>
                    <thead>
                      <tr>
                        {preview.headers.map((header, i) => (
                          <th key={i}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.totalRows && preview.totalRows > 5 && (
                    <div className={styles.previewMore}>
                      ...a dalších {(preview.totalRows - 5).toLocaleString('cs-CZ')} řádků
                    </div>
                  )}
                </div>
              )}

              {/* ZIP file info */}
              {preview.isZip && (
                <div className={styles.zipInfo}>
                  <p>
                    ZIP soubor bude rozbalen a soubory budou importovány v pořadí:
                  </p>
                  <ol className={styles.importOrder}>
                    <li>Zákazníci (customers)</li>
                    <li>Zařízení (devices)</li>
                    <li>Revize (revisions)</li>
                    <li>Komunikace (communications)</li>
                    <li>Návštěvy (visits)</li>
                  </ol>
                  <p className={styles.zipNote}>
                    Typy souborů jsou automaticky rozpoznány podle názvu souboru.
                  </p>
                </div>
              )}

              <div className={styles.previewActions}>
                <button className={styles.cancelButton} onClick={handleReset}>
                  Vybrat jiný soubor
                </button>
                <button className={styles.importButton} onClick={handleSubmitImport}>
                  Spustit import
                </button>
              </div>
            </div>
          )}

          {/* Submitting state */}
          {state === 'submitting' && (
            <div className={styles.processing}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>Odesílám úlohu importu...</p>
            </div>
          )}

          {/* Submitted state */}
          {state === 'submitted' && (
            <div className={styles.submitted}>
              <div className={styles.successIcon}>✓</div>
              <p className={styles.successText}>Import byl spuštěn</p>
              <p className={styles.successHint}>
                Průběh můžete sledovat v sekci Úlohy nebo v horní liště.
              </p>
              {submittedJobId && (
                <small className={styles.jobId}>Job ID: {submittedJobId.slice(0, 8)}...</small>
              )}
            </div>
          )}

          {/* Error state */}
          {state === 'error' && (
            <div className={styles.error}>
              <div className={styles.errorIcon}>❌</div>
              <p className={styles.errorText}>{error}</p>
              <button className={styles.retryButton} onClick={handleReset}>
                Zkusit znovu
              </button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {state === 'idle' && (
            <a
              href="/IMPORT_FORMAT.MD"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.helpLink}
            >
              Nápověda k formátu {entityType === 'zip' ? 'ZIP' : 'CSV'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
