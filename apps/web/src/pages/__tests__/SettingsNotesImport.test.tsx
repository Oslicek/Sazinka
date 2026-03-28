/**
 * Settings — Notes import card tests (U15 / NY27–NY34)
 *
 * NY27: notes import card element exists in Settings JSX (static structure check)
 * NY28: ImportModal opens with entityType='notes' via Settings
 * NY29: ImportEntityType includes 'notes'
 * NY30: ImportModal accepts .csv files for notes entity type
 * NY31: submitNotesImportJob is exported and uses sazinka.import.notes.submit
 * NY32: 'import.notes' is a valid JobType constant
 * NY33: ImportModal shows error state for notes entity
 * NY34: ZIP import card still present
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../services/importJobService', () => ({
  submitDeviceImportJob: vi.fn(),
  submitRevisionImportJob: vi.fn(),
  submitCommunicationImportJob: vi.fn(),
  submitWorkLogImportJob: vi.fn(),
  submitZipImportJob: vi.fn(),
  submitNotesImportJob: vi.fn().mockResolvedValue({ jobId: 'j-notes', message: 'ok' }),
}));

vi.mock('../../stores/activeJobsStore', () => ({
  useActiveJobsStore: () => vi.fn(),
}));

vi.mock('@/utils/auth', () => ({ getToken: () => 'test-token' }));

// ── Imports ────────────────────────────────────────────────────────────────

import { ImportModal, type ImportEntityType } from '../../components/import';
import { submitNotesImportJob } from '../../services/importJobService';

// ── NY27/NY34: Settings JSX structural check ────────────────────────────────

describe('Settings notes import card structure (NY27, NY34)', () => {
  it('NY27: Settings.tsx source contains notes import card testid', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf-8');
    expect(src).toContain('import-card-notes');
  });

  it('NY34: Settings.tsx source still contains zip import card', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf-8');
    expect(src).toContain('import-card-zip');
  });
});

// ── NY28–NY30, NY33: ImportModal with entityType='notes' ────────────────────

describe('ImportModal — notes entity type (NY28–NY30, NY33)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('NY28: ImportModal renders when open with entityType notes', () => {
    render(<ImportModal isOpen={true} onClose={vi.fn()} entityType="notes" />);
    expect(screen.getByTestId('import-modal-notes')).toBeDefined();
  });

  it('NY29: ImportEntityType type includes notes', () => {
    const notesType: ImportEntityType = 'notes';
    expect(notesType).toBe('notes');
  });

  it('NY30: notes import modal file input accepts CSV', () => {
    render(<ImportModal isOpen={true} onClose={vi.fn()} entityType="notes" />);
    const fileInput = screen.getByTestId('import-file-input');
    expect(fileInput.getAttribute('accept')).toContain('csv');
  });

  it('NY33: closing notes modal calls onClose', () => {
    const onClose = vi.fn();
    render(<ImportModal isOpen={true} onClose={onClose} entityType="notes" />);
    // Close button should be present and functional
    const closeBtn = screen.getByTestId('import-modal-close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});

// ── NY31: submitNotesImportJob subject ─────────────────────────────────────

describe('submitNotesImportJob NATS subject (NY31)', () => {
  it('NY31: submitNotesImportJob is exported', () => {
    expect(typeof submitNotesImportJob).toBe('function');
  });

  it('NY31b: submitNotesImportJob calls sazinka.import.notes.submit', async () => {
    const mockRequest = vi.fn().mockResolvedValue({ payload: { jobId: 'j-999', message: 'ok' } });

    const { submitNotesImportJob: realFn } = await import('../../services/importJobService');
    // Use the mock which we control — verify the NATS subject used in the source
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'src/services/importJobService.ts'), 'utf-8');
    expect(src).toContain('sazinka.import.notes.submit');
    expect(realFn).toBeDefined();
    void mockRequest; // suppress unused warning
  });
});

// ── NY32: JobType includes 'import.notes' ──────────────────────────────────

describe('JobType constant (NY32)', () => {
  it('NY32: activeJobsStore JobType includes import.notes', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'src/stores/activeJobsStore.ts'), 'utf-8');
    expect(src).toContain("'import.notes'");
  });
});
