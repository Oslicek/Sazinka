import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportReportDialog } from './ImportReportDialog';
import type { ImportReport } from '@shared/import';

vi.mock('@/i18n/resolveBackendMessage', () => ({
  resolveBackendMessage: (msg: string) => msg,
}));

vi.mock('../../i18n/formatters', () => ({
  formatDate: (d: Date) => d.toISOString().split('T')[0],
  formatTime: (s: string) => s.split('T')[1]?.split('.')[0] ?? '',
}));

const makeReport = (overrides: Partial<ImportReport> = {}): ImportReport => ({
  jobId: 'test-job-id',
  jobType: 'import.customer',
  filename: 'customers.csv',
  totalRows: 10,
  importedCount: 8,
  updatedCount: 0,
  skippedCount: 2,
  issues: [],
  importedAt: '2024-01-01T10:00:00Z',
  durationMs: 1500,
  ...overrides,
});

describe('ImportReportDialog', () => {
  it('renders report title and filename', () => {
    render(<ImportReportDialog report={makeReport()} onClose={() => {}} />);
    expect(screen.getByText('report_title')).toBeInTheDocument();
    expect(screen.getByText(/customers\.csv/)).toBeInTheDocument();
  });

  it('shows success status when no issues', () => {
    render(<ImportReportDialog report={makeReport()} onClose={() => {}} />);
    expect(screen.getByText('report_status_success')).toBeInTheDocument();
  });

  it('shows error status when errors present', () => {
    const report = makeReport({
      issues: [{ code: 'CUSTOMER_NOT_FOUND', level: 'error', message: 'Not found', rowNumber: 1, field: 'customer_ref' }],
    });
    render(<ImportReportDialog report={report} onClose={() => {}} />);
    expect(screen.getByText('report_status_errors')).toBeInTheDocument();
  });

  it('shows warning status when only warnings present', () => {
    const report = makeReport({
      issues: [{ code: 'DUPLICATE_RECORD', level: 'warning', message: 'Duplicate', rowNumber: 2, field: 'email' }],
    });
    render(<ImportReportDialog report={report} onClose={() => {}} />);
    expect(screen.getByText('report_status_warnings')).toBeInTheDocument();
  });

  it('displays imported count', () => {
    render(<ImportReportDialog report={makeReport({ importedCount: 8 })} onClose={() => {}} />);
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ImportReportDialog report={makeReport()} onClose={onClose} />);
    const closeButtons = screen.getAllByRole('button', { name: 'report_close' });
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ImportReportDialog report={makeReport()} onClose={onClose} />);
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows issue summary when issues exist', () => {
    const report = makeReport({
      issues: [
        { code: 'CUSTOMER_NOT_FOUND', level: 'error', message: 'Not found', rowNumber: 1, field: 'customer_ref' },
        { code: 'CUSTOMER_NOT_FOUND', level: 'error', message: 'Not found', rowNumber: 2, field: 'customer_ref' },
      ],
    });
    render(<ImportReportDialog report={report} onClose={() => {}} />);
    expect(screen.getByText('report_issues_title')).toBeInTheDocument();
  });

  it('recognizes import.work_log job type', () => {
    const report = makeReport({ jobType: 'import.work_log', filename: 'work_log.csv' });
    render(<ImportReportDialog report={report} onClose={() => {}} />);
    expect(screen.getByText(/work_log\.csv/)).toBeInTheDocument();
    expect(screen.getByText(/report_job_work_log/)).toBeInTheDocument();
  });

  it('does not show import.visit job type (renamed to work_log)', () => {
    const report = makeReport({ jobType: 'import.work_log' });
    render(<ImportReportDialog report={report} onClose={() => {}} />);
    expect(screen.queryByText(/report_job_visit/)).not.toBeInTheDocument();
  });
});
