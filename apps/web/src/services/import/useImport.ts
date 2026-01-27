/**
 * React hook for customer import functionality
 */

import { useState, useCallback, useRef } from 'react';
import type { 
  CreateCustomerRequest, 
  ImportIssue, 
  ImportReport 
} from '@shared/customer';
import { generateTextReport } from './importService';
import type { 
  ImportWorkerRequest, 
  ImportWorkerMessage,
  ImportWorkerProgress,
  ImportWorkerResult,
  ImportWorkerError,
} from './importWorker';

export interface ImportState {
  status: 'idle' | 'processing' | 'sending' | 'complete' | 'error';
  progress: number;
  total: number;
  error: string | null;
  report: ImportReport | null;
  textReport: string | null;
}

export interface UseImportReturn {
  state: ImportState;
  startImport: (file: File) => Promise<void>;
  reset: () => void;
}

export interface ImportOptions {
  onBatchReady?: (customers: CreateCustomerRequest[]) => Promise<{ 
    importedCount: number; 
    updatedCount: number;
    errors: ImportIssue[];
  }>;
}

const initialState: ImportState = {
  status: 'idle',
  progress: 0,
  total: 0,
  error: null,
  report: null,
  textReport: null,
};

/**
 * Hook for managing customer import process
 */
export function useImport(options: ImportOptions = {}): UseImportReturn {
  const [state, setState] = useState<ImportState>(initialState);
  const workerRef = useRef<Worker | null>(null);
  const fileNameRef = useRef<string>('');

  const reset = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setState(initialState);
  }, []);

  const startImport = useCallback(async (file: File) => {
    reset();
    fileNameRef.current = file.name;

    setState(prev => ({
      ...prev,
      status: 'processing',
      progress: 0,
      total: 0,
    }));

    try {
      // Read file content
      const csvContent = await file.text();

      // Create worker
      const worker = new Worker(
        new URL('./importWorker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      // Handle worker messages
      worker.onmessage = async (event: MessageEvent<ImportWorkerMessage>) => {
        const message = event.data;

        switch (message.type) {
          case 'progress':
            setState(prev => ({
              ...prev,
              progress: message.processed,
              total: message.total,
            }));
            break;

          case 'result':
            await handleResult(message);
            break;

          case 'error':
            setState(prev => ({
              ...prev,
              status: 'error',
              error: message.message,
            }));
            break;
        }
      };

      worker.onerror = (error) => {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: error.message || 'Worker error',
        }));
      };

      // Start processing
      worker.postMessage({
        type: 'start',
        filename: file.name,
        csvContent,
      } as ImportWorkerRequest);

    } catch (error) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to start import',
      }));
    }

    async function handleResult(result: ImportWorkerResult) {
      const { customers, issues, totalRows, skippedCount, durationMs } = result;
      let importedCount = 0;
      let updatedCount = 0;
      const allIssues = [...issues];

      // Send to server if callback provided
      if (options.onBatchReady && customers.length > 0) {
        setState(prev => ({ ...prev, status: 'sending' }));

        try {
          // Send in batches
          const batchSize = 100;
          for (let i = 0; i < customers.length; i += batchSize) {
            const batch = customers.slice(i, i + batchSize);
            const response = await options.onBatchReady(batch);
            importedCount += response.importedCount;
            updatedCount += response.updatedCount;
            allIssues.push(...response.errors);

            // Update progress
            setState(prev => ({
              ...prev,
              progress: Math.min(i + batchSize, customers.length),
              total: customers.length,
            }));
          }
        } catch (error) {
          allIssues.push({
            rowNumber: 0,
            level: 'error',
            field: 'server',
            message: error instanceof Error ? error.message : 'Server error',
          });
        }
      } else {
        // No server callback - just count parsed customers
        importedCount = customers.length;
      }

      // Generate report
      const report: ImportReport = {
        filename: fileNameRef.current,
        importedAt: new Date().toISOString(),
        durationMs,
        totalRows,
        importedCount,
        updatedCount,
        skippedCount,
        issues: allIssues,
      };

      const textReport = generateTextReport(report);

      setState(prev => ({
        ...prev,
        status: 'complete',
        report,
        textReport,
      }));

      // Cleanup worker
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    }
  }, [options, reset]);

  return {
    state,
    startImport,
    reset,
  };
}
