/**
 * Universal Modal for importing entities from CSV files
 * Supports: devices, revisions, communications, visits
 * Also supports ZIP files containing multiple CSV files
 * 
 * All imports are processed asynchronously via job queue.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  submitDeviceImportJob,
  submitRevisionImportJob,
  submitCommunicationImportJob,
  submitWorkLogImportJob,
  submitZipImportJob,
} from '../../services/importJobService';
import { useActiveJobsStore } from '../../stores/activeJobsStore';
import type { JobType } from '../../stores/activeJobsStore';
import { getToken } from '@/utils/auth';
import styles from './ImportModal.module.css';

export type ImportEntityType = 'device' | 'revision' | 'communication' | 'work_log' | 'zip';

const ENTITY_LABEL_KEYS: Record<ImportEntityType, string> = {
  device: 'modal_entity_device',
  revision: 'modal_entity_revision',
  communication: 'modal_entity_communication',
  work_log: 'modal_entity_work_log',
  zip: 'modal_entity_zip',
};

const ENTITY_TITLE_KEYS: Record<ImportEntityType, string> = {
  device: 'modal_title_device',
  revision: 'modal_title_revision',
  communication: 'modal_title_communication',
  work_log: 'modal_title_work_log',
  zip: 'modal_title_zip',
};

const JOB_TYPES: Record<ImportEntityType, JobType> = {
  device: 'import.device',
  revision: 'import.revision',
  communication: 'import.communication',
  work_log: 'import.work_log',
  zip: 'import.zip',
};

const ACCEPTED_FILES: Record<ImportEntityType, string> = {
  device: '.csv,text/csv',
  revision: '.csv,text/csv',
  communication: '.csv,text/csv',
  work_log: '.csv,text/csv',
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
  const { t } = useTranslation('import');
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
            reject(new Error(t('modal_csv_min_rows')));
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

      reader.onerror = () => reject(new Error(t('modal_error_read')));
      reader.readAsText(file, 'utf-8');
    });
  }, [t]);

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

      reader.onerror = () => reject(new Error(t('modal_error_read_zip')));
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    const isZip = file.name.endsWith('.zip') || file.type.includes('zip');
    const expectsZip = entityType === 'zip';

    if (expectsZip && !isZip) {
      setError(t('modal_error_select_zip'));
      setState('error');
      return;
    }

    if (!expectsZip && isZip) {
      setError(t('modal_error_select_csv_not_zip'));
      setState('error');
      return;
    }

    if (!expectsZip && !file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setError(t('modal_error_select_csv'));
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
      setError(err instanceof Error ? err.message : t('modal_error_process'));
      setState('error');
    }
  }, [entityType, parseCSVPreview, parseZipPreview, t]);

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

  const submittingRef = useRef(false);
  const handleSubmitImport = useCallback(async () => {
    if (!preview || submittingRef.current) return;
    submittingRef.current = true;

    setState('submitting');
    setError(null);

    try {
      let result: { jobId: string; message: string };

      switch (entityType) {
        case 'device':
          result = await submitDeviceImportJob(preview.content, preview.filename);
          break;
        case 'revision':
          result = await submitRevisionImportJob(preview.content, preview.filename);
          break;
        case 'communication':
          result = await submitCommunicationImportJob(preview.content, preview.filename);
          break;
        case 'work_log':
          result = await submitWorkLogImportJob(preview.content, preview.filename);
          break;
        case 'zip':
          result = await submitZipImportJob(preview.content, preview.filename);
          break;
        default:
          throw new Error(`${t('modal_unsupported_type')}: ${entityType}`);
      }

      // Add job to active jobs store for immediate tracking
      addJob({
        id: result.jobId,
        type: JOB_TYPES[entityType],
        name: `Import: ${preview.filename}`,
        status: 'queued',
        progressText: t('modal_queue_waiting'),
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
      setError(err instanceof Error ? err.message : t('modal_error_submit'));
      setState('error');
      submittingRef.current = false;
    }
  }, [preview, entityType, addJob, onComplete]);

  const handleClose = useCallback(() => {
    setState('idle');
    setPreview(null);
    setError(null);
    setSubmittedJobId(null);
    submittingRef.current = false;
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
          <h2>{t(ENTITY_TITLE_KEYS[entityType])}</h2>
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
                {entityType === 'zip' ? t('modal_drop_text_zip') : t('modal_drop_text_csv')}
              </p>
              <p className={styles.dropHint}>
                {t('modal_drop_hint')}
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
              <p className={styles.processingText}>{t('modal_parsing')}</p>
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
                      {preview.totalRows} {t(ENTITY_LABEL_KEYS[entityType])}
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
                      {t('customer_more_rows', { count: preview.totalRows - 5 })}
                    </div>
                  )}
                </div>
              )}

              {/* ZIP file info */}
              {preview.isZip && (
                <div className={styles.zipInfo}>
                  <p>
                    {t('modal_zip_info')}
                  </p>
                  <ol className={styles.importOrder}>
                    <li>{t('modal_zip_customers')}</li>
                    <li>{t('modal_zip_devices')}</li>
                    <li>{t('modal_zip_worklog')}</li>
                  </ol>
                  <p className={styles.zipNote}>
                    {t('modal_zip_auto')}
                  </p>
                </div>
              )}

              <div className={styles.previewActions}>
                <button className={styles.cancelButton} onClick={handleReset}>
                  {t('modal_select_other')}
                </button>
                <button className={styles.importButton} onClick={handleSubmitImport} disabled={state === 'submitting'}>
                  {t('customer_start_import')}
                </button>
              </div>
            </div>
          )}

          {/* Submitting state */}
          {state === 'submitting' && (
            <div className={styles.processing}>
              <div className={styles.spinner} />
              <p className={styles.processingText}>{t('modal_submitting')}</p>
            </div>
          )}

          {/* Submitted state */}
          {state === 'submitted' && (
            <div className={styles.submitted}>
              <div className={styles.successIcon}>✓</div>
              <p className={styles.successText}>{t('modal_submitted')}</p>
              <p className={styles.successHint}>
                {t('modal_submitted_hint')}
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
                {t('customer_retry')}
              </button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {state === 'idle' && (
            <a
              href="/PROJECT_IMPORT.MD"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.helpLink}
            >
              {t('modal_csv_help')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
