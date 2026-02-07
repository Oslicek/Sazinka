/**
 * Modal for importing customers from CSV file
 * Submits import as a background job and closes immediately
 */

import { useCallback, useRef, useState } from 'react';
import { submitCustomerImportJob } from '../../services/importJobService';
import { useActiveJobsStore } from '../../stores/activeJobsStore';
import styles from './ImportCustomersModal.module.css';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

interface ImportCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalState = 'idle' | 'parsing' | 'preview' | 'submitting' | 'submitted' | 'error';

interface CsvPreview {
  filename: string;
  totalRows: number;
  sampleRows: string[][];
  headers: string[];
  csvContent: string;
}

export function ImportCustomersModal({ 
  isOpen, 
  onClose,
}: ImportCustomersModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<ModalState>('idle');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  
  const addJob = useActiveJobsStore((s) => s.addJob);

  const parseCSVPreview = useCallback(async (file: File): Promise<CsvPreview> => {
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
            csvContent: text,
          });
        } catch (err) {
          reject(err);
        }
      };
      
      reader.onerror = () => reject(new Error('Nepodařilo se načíst soubor'));
      reader.readAsText(file, 'utf-8');
    });
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setError('Prosím vyberte soubor CSV.');
      setState('error');
      return;
    }
    
    setState('parsing');
    setError(null);
    
    try {
      const csvPreview = await parseCSVPreview(file);
      setPreview(csvPreview);
      setState('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se zpracovat soubor');
      setState('error');
    }
  }, [parseCSVPreview]);

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
      const result = await submitCustomerImportJob(
        USER_ID,
        preview.csvContent,
        preview.filename
      );
      
      // Add job to active jobs store for immediate tracking
      addJob({
        id: result.jobId,
        type: 'import.customer',
        name: `Import: ${preview.filename}`,
        status: 'queued',
        progressText: 'Čeká ve frontě...',
        startedAt: new Date(),
      });
      
      setSubmittedJobId(result.jobId);
      setState('submitted');
      
      // Close modal after a brief moment to show success
      setTimeout(() => {
        handleClose();
      }, 1500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se spustit import');
      setState('error');
    }
  }, [preview, addJob]);

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

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Import zákazníků</h2>
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
                  <span className={styles.rowCount}>{preview.totalRows.toLocaleString('cs-CZ')} zákazníků</span>
                </div>
              </div>
              
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
                {preview.totalRows > 5 && (
                  <div className={styles.previewMore}>
                    ...a dalších {(preview.totalRows - 5).toLocaleString('cs-CZ')} řádků
                  </div>
                )}
              </div>
              
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
              href="/PROJECT_IMPORT.MD" 
              target="_blank" 
              rel="noopener noreferrer"
              className={styles.helpLink}
            >
              Nápověda k formátu CSV
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
