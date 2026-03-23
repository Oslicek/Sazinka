import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportModal } from './ImportModal';

vi.mock('../../services/importJobService', () => ({
  submitDeviceImportJob: vi.fn(),
  submitRevisionImportJob: vi.fn(),
  submitCommunicationImportJob: vi.fn(),
  submitWorkLogImportJob: vi.fn(),
  submitZipImportJob: vi.fn(),
}));

vi.mock('../../stores/activeJobsStore', () => ({
  useActiveJobsStore: () => vi.fn(),
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

describe('ImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    render(
      <ImportModal isOpen={false} onClose={() => {}} entityType="device" />
    );
    expect(screen.queryByText('modal_title_device')).not.toBeInTheDocument();
  });

  it('renders device import title when open', () => {
    render(
      <ImportModal isOpen={true} onClose={() => {}} entityType="device" />
    );
    expect(screen.getByText('modal_title_device')).toBeInTheDocument();
  });

  it('renders revision import title when open', () => {
    render(
      <ImportModal isOpen={true} onClose={() => {}} entityType="revision" />
    );
    expect(screen.getByText('modal_title_revision')).toBeInTheDocument();
  });

  it('renders communication import title when open', () => {
    render(
      <ImportModal isOpen={true} onClose={() => {}} entityType="communication" />
    );
    expect(screen.getByText('modal_title_communication')).toBeInTheDocument();
  });

  it('renders work_log import title when open', () => {
    render(
      <ImportModal isOpen={true} onClose={() => {}} entityType="work_log" />
    );
    expect(screen.getByText('modal_title_work_log')).toBeInTheDocument();
  });

  it('renders zip import title when open', () => {
    render(
      <ImportModal isOpen={true} onClose={() => {}} entityType="zip" />
    );
    expect(screen.getByText('modal_title_zip')).toBeInTheDocument();
  });

  it('shows drop zone in idle state', () => {
    render(
      <ImportModal isOpen={true} onClose={() => {}} entityType="device" />
    );
    expect(screen.getByText('modal_drop_text_csv')).toBeInTheDocument();
  });
});

describe('ImportModal entity types coverage', () => {
  const entityTypes = ['device', 'revision', 'communication', 'work_log', 'zip'] as const;

  entityTypes.forEach((entityType) => {
    it(`renders correctly for entity type: ${entityType}`, () => {
      render(
        <ImportModal isOpen={true} onClose={() => {}} entityType={entityType} />
      );
      expect(screen.getByText(`modal_title_${entityType}`)).toBeInTheDocument();
    });
  });
});
