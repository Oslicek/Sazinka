/**
 * Web Worker for customer import processing
 * 
 * Handles CSV parsing and normalization in a background thread
 * to keep the UI responsive during large imports.
 */

import { parseCsv, normalizeCustomerRow, isRowImportable } from './importService';
import type { 
  CreateCustomerRequest, 
  ImportIssue, 
  ImportReport,
  CsvCustomerRow 
} from '@shared/customer';

// Message types
export interface ImportWorkerRequest {
  type: 'start';
  filename: string;
  csvContent: string;
}

export interface ImportWorkerProgress {
  type: 'progress';
  processed: number;
  total: number;
}

export interface ImportWorkerResult {
  type: 'result';
  customers: CreateCustomerRequest[];
  issues: ImportIssue[];
  totalRows: number;
  skippedCount: number;
  durationMs: number;
}

export interface ImportWorkerError {
  type: 'error';
  message: string;
}

export type ImportWorkerMessage = 
  | ImportWorkerProgress 
  | ImportWorkerResult 
  | ImportWorkerError;

// Worker context
const ctx: Worker = self as any;

/**
 * Process import in batches to allow progress updates
 */
async function processImport(
  filename: string,
  csvContent: string
): Promise<void> {
  const startTime = performance.now();
  
  try {
    // Parse CSV
    const parseResult = parseCsv(csvContent);
    
    if (parseResult.errors.length > 0) {
      // Report parse errors
      const errorIssues: ImportIssue[] = parseResult.errors.map((err, idx) => ({
        rowNumber: err.row ?? idx + 1,
        level: 'error' as const,
        field: 'csv',
        message: err.message,
      }));
      
      ctx.postMessage({
        type: 'error',
        message: `CSV parsing failed: ${parseResult.errors[0].message}`,
      } as ImportWorkerError);
      return;
    }

    const rows = parseResult.data;
    const total = rows.length;
    const customers: CreateCustomerRequest[] = [];
    const issues: ImportIssue[] = [];
    let skippedCount = 0;

    // Process in batches for progress reporting
    const batchSize = 100;
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because row 1 is header, data starts at row 2

      // Check if row is importable
      if (!isRowImportable(row)) {
        skippedCount++;
        continue;
      }

      // Normalize the row
      const result = normalizeCustomerRow(row, rowNumber);
      customers.push(result.customer);
      issues.push(...result.issues);

      // Report progress every batch
      if ((i + 1) % batchSize === 0 || i === rows.length - 1) {
        ctx.postMessage({
          type: 'progress',
          processed: i + 1,
          total,
        } as ImportWorkerProgress);
        
        // Yield to allow message processing
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const durationMs = performance.now() - startTime;

    // Send final result
    ctx.postMessage({
      type: 'result',
      customers,
      issues,
      totalRows: total,
      skippedCount,
      durationMs,
    } as ImportWorkerResult);

  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    } as ImportWorkerError);
  }
}

// Handle messages from main thread
ctx.onmessage = (event: MessageEvent<ImportWorkerRequest>) => {
  const { type, filename, csvContent } = event.data;
  
  if (type === 'start') {
    processImport(filename, csvContent);
  }
};
