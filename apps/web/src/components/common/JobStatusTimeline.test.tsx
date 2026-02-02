import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobStatusTimeline, DEFAULT_STEPS } from './JobStatusTimeline';
import type { JobStatus } from '../../types/jobStatus';

describe('JobStatusTimeline', () => {
  describe('with null status', () => {
    it('renders all steps as pending', () => {
      render(<JobStatusTimeline status={null} />);
      
      expect(screen.getByText('Fronta')).toBeInTheDocument();
      expect(screen.getByText('Zpracování')).toBeInTheDocument();
      expect(screen.getByText('Hotovo')).toBeInTheDocument();
    });

    it('shows no active step', () => {
      render(<JobStatusTimeline status={null} />);
      
      const steps = screen.getAllByTestId('timeline-step');
      steps.forEach(step => {
        expect(step).toHaveAttribute('data-state', 'pending');
      });
    });
  });

  describe('with queued status', () => {
    const queuedStatus: JobStatus = { type: 'queued', position: 3 };

    it('renders queued step as active', () => {
      render(<JobStatusTimeline status={queuedStatus} />);
      
      const queuedStep = screen.getByTestId('step-queued');
      expect(queuedStep).toHaveAttribute('data-state', 'active');
    });

    it('shows queue position when provided', () => {
      render(<JobStatusTimeline status={queuedStatus} />);
      
      expect(screen.getByText('Pozice: 3')).toBeInTheDocument();
    });
  });

  describe('with processing status', () => {
    const processingStatus: JobStatus = {
      type: 'processing',
      progress: 65,
      message: 'Budování matice',
    };

    it('renders processing step as active', () => {
      render(<JobStatusTimeline status={processingStatus} />);
      
      const processingStep = screen.getByTestId('step-processing');
      expect(processingStep).toHaveAttribute('data-state', 'active');
    });

    it('marks queued step as done', () => {
      render(<JobStatusTimeline status={processingStatus} />);
      
      const queuedStep = screen.getByTestId('step-queued');
      expect(queuedStep).toHaveAttribute('data-state', 'done');
    });

    it('shows progress bar when showProgress is true', () => {
      render(<JobStatusTimeline status={processingStatus} showProgress />);
      
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveAttribute('aria-valuenow', '65');
    });

    it('shows progress message', () => {
      render(<JobStatusTimeline status={processingStatus} />);
      
      expect(screen.getByText('Budování matice')).toBeInTheDocument();
    });

    it('hides progress bar when showProgress is false', () => {
      render(<JobStatusTimeline status={processingStatus} showProgress={false} />);
      
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('with completed status', () => {
    const completedStatus: JobStatus = { type: 'completed', result: { id: '1' } };

    it('renders completed step as done', () => {
      render(<JobStatusTimeline status={completedStatus} />);
      
      const completedStep = screen.getByTestId('step-completed');
      expect(completedStep).toHaveAttribute('data-state', 'done');
    });

    it('marks all previous steps as done', () => {
      render(<JobStatusTimeline status={completedStatus} />);
      
      const queuedStep = screen.getByTestId('step-queued');
      const processingStep = screen.getByTestId('step-processing');
      
      expect(queuedStep).toHaveAttribute('data-state', 'done');
      expect(processingStep).toHaveAttribute('data-state', 'done');
    });
  });

  describe('with failed status', () => {
    const failedStatus: JobStatus = { type: 'failed', error: 'Network error' };

    it('shows error state on last step', () => {
      render(<JobStatusTimeline status={failedStatus} />);
      
      const completedStep = screen.getByTestId('step-completed');
      expect(completedStep).toHaveAttribute('data-state', 'error');
    });

    it('shows failedLabel instead of regular label', () => {
      render(<JobStatusTimeline status={failedStatus} />);
      
      expect(screen.getByText('Selhalo')).toBeInTheDocument();
      // 'Hotovo' should not be visible when failed
      expect(screen.queryByText('Hotovo')).not.toBeInTheDocument();
    });

    it('shows error message', () => {
      render(<JobStatusTimeline status={failedStatus} />);
      
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  describe('custom steps', () => {
    const customSteps = [
      { id: 'parse', label: 'Parsování' },
      { id: 'send', label: 'Odesílání' },
      { id: 'geocode', label: 'Geokódování' },
      { id: 'done', label: 'Hotovo', failedLabel: 'Chyba' },
    ];

    it('renders custom step labels', () => {
      render(<JobStatusTimeline status={null} steps={customSteps} />);
      
      expect(screen.getByText('Parsování')).toBeInTheDocument();
      expect(screen.getByText('Odesílání')).toBeInTheDocument();
      expect(screen.getByText('Geokódování')).toBeInTheDocument();
      expect(screen.getByText('Hotovo')).toBeInTheDocument();
    });
  });

  describe('size variants', () => {
    it('applies sm size via data-size', () => {
      render(<JobStatusTimeline status={null} size="sm" />);
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveAttribute('data-size', 'sm');
    });

    it('applies lg size via data-size', () => {
      render(<JobStatusTimeline status={null} size="lg" />);
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveAttribute('data-size', 'lg');
    });

    it('defaults to md size', () => {
      render(<JobStatusTimeline status={null} />);
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveAttribute('data-size', 'md');
    });
  });

  describe('custom className', () => {
    it('applies custom className', () => {
      render(<JobStatusTimeline status={null} className="my-custom-class" />);
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveClass('my-custom-class');
    });
  });

  describe('DEFAULT_STEPS', () => {
    it('has correct default steps', () => {
      expect(DEFAULT_STEPS).toEqual([
        { id: 'queued', label: 'Fronta' },
        { id: 'processing', label: 'Zpracování' },
        { id: 'completed', label: 'Hotovo', failedLabel: 'Selhalo' },
      ]);
    });
  });
});
