import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportPlusPanel } from './ExportPlusPanel';

vi.mock('@/services/workerService', () => ({
  listWorkers: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/stores/activeJobsStore', () => ({
  useActiveJobsStore: () => vi.fn(),
}));

vi.mock('@/services/exportPlusService', () => ({
  submitExportJob: vi.fn(),
  subscribeExportJob: vi.fn().mockResolvedValue(() => {}),
  downloadExportJob: vi.fn(),
}));

describe('ExportPlusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders file selection options', () => {
    render(<ExportPlusPanel />);
    expect(screen.getByText('customers.csv')).toBeInTheDocument();
    expect(screen.getByText('devices.csv')).toBeInTheDocument();
    expect(screen.getByText('revisions.csv')).toBeInTheDocument();
    expect(screen.getByText('communications.csv')).toBeInTheDocument();
    expect(screen.getByText('work_log.csv')).toBeInTheDocument();
  });

  it('renders export button', () => {
    render(<ExportPlusPanel />);
    expect(screen.getByRole('button', { name: /export_start/i })).toBeInTheDocument();
  });

  it('renders scope selector in admin mode', () => {
    render(<ExportPlusPanel adminMode={true} />);
    expect(screen.getByText('export_scope_title')).toBeInTheDocument();
  });
});

describe('ExportPlusPanel file types', () => {
  it('all canonical export file types are present', () => {
    const { container } = render(<ExportPlusPanel />);
    const text = container.textContent ?? '';
    expect(text).toContain('customers.csv');
    expect(text).toContain('devices.csv');
    expect(text).toContain('revisions.csv');
    expect(text).toContain('communications.csv');
    expect(text).toContain('work_log.csv');
    expect(text).toContain('routes.csv');
  });

  it('does not show visit.csv (renamed to work_log.csv)', () => {
    const { container } = render(<ExportPlusPanel />);
    expect(container.textContent).not.toContain('visit.csv');
  });
});
