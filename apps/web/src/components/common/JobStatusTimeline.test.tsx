import { describe, it, expect, beforeAll, vi } from 'vitest';

// Restore real react-i18next (global setup mocks it)
vi.unmock('react-i18next');

import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { JobStatusTimeline, DEFAULT_STEPS } from './JobStatusTimeline';
import type { JobStatus } from '../../types/jobStatus';

import enNav from '../../../public/locales/en/nav.json';
import csNav from '../../../public/locales/cs/nav.json';

// ── i18n test instance ──
const testI18n = i18next.createInstance();

beforeAll(async () => {
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'cs'],
    ns: ['nav'],
    defaultNS: 'nav',
    resources: {
      en: { nav: enNav },
      cs: { nav: csNav },
    },
    interpolation: { escapeValue: false },
  });
});

function renderTimeline(status: JobStatus | null, props?: Partial<React.ComponentProps<typeof JobStatusTimeline>>) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <JobStatusTimeline status={status} {...props} />
    </I18nextProvider>,
  );
}

describe('JobStatusTimeline', () => {
  describe('with null status', () => {
    it('renders all steps as pending', () => {
      renderTimeline(null);
      
      expect(screen.getByText('Queued')).toBeInTheDocument();
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    it('shows no active step', () => {
      renderTimeline(null);
      
      const steps = screen.getAllByTestId('timeline-step');
      steps.forEach(step => {
        expect(step).toHaveAttribute('data-state', 'pending');
      });
    });
  });

  describe('with queued status', () => {
    const queuedStatus: JobStatus = { type: 'queued', position: 3 };

    it('renders queued step as active', () => {
      renderTimeline(queuedStatus);
      
      const queuedStep = screen.getByTestId('step-queued');
      expect(queuedStep).toHaveAttribute('data-state', 'active');
    });

    it('shows queue position when provided', () => {
      renderTimeline(queuedStatus);
      
      expect(screen.getByText('Position: 3')).toBeInTheDocument();
    });
  });

  describe('with processing status', () => {
    const processingStatus: JobStatus = {
      type: 'processing',
      progress: 65,
      message: 'Building matrix',
    };

    it('renders processing step as active', () => {
      renderTimeline(processingStatus);
      
      const processingStep = screen.getByTestId('step-processing');
      expect(processingStep).toHaveAttribute('data-state', 'active');
    });

    it('marks queued step as done', () => {
      renderTimeline(processingStatus);
      
      const queuedStep = screen.getByTestId('step-queued');
      expect(queuedStep).toHaveAttribute('data-state', 'done');
    });

    it('shows progress bar when showProgress is true', () => {
      renderTimeline(processingStatus, { showProgress: true });
      
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveAttribute('aria-valuenow', '65');
    });

    it('shows progress message', () => {
      renderTimeline(processingStatus);
      
      expect(screen.getByText('Building matrix')).toBeInTheDocument();
    });

    it('hides progress bar when showProgress is false', () => {
      renderTimeline(processingStatus, { showProgress: false });
      
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('with completed status', () => {
    const completedStatus: JobStatus = { type: 'completed', result: { id: '1' } };

    it('renders completed step as done', () => {
      renderTimeline(completedStatus);
      
      const completedStep = screen.getByTestId('step-completed');
      expect(completedStep).toHaveAttribute('data-state', 'done');
    });

    it('marks all previous steps as done', () => {
      renderTimeline(completedStatus);
      
      const queuedStep = screen.getByTestId('step-queued');
      const processingStep = screen.getByTestId('step-processing');
      
      expect(queuedStep).toHaveAttribute('data-state', 'done');
      expect(processingStep).toHaveAttribute('data-state', 'done');
    });
  });

  describe('with failed status', () => {
    const failedStatus: JobStatus = { type: 'failed', error: 'Network error' };

    it('shows error state on last step', () => {
      renderTimeline(failedStatus);
      
      const completedStep = screen.getByTestId('step-completed');
      expect(completedStep).toHaveAttribute('data-state', 'error');
    });

    it('shows failedLabel instead of regular label', () => {
      renderTimeline(failedStatus);
      
      expect(screen.getByText('Failed')).toBeInTheDocument();
      // 'Done' should not be visible when failed
      expect(screen.queryByText('Done')).not.toBeInTheDocument();
    });

    it('shows error message', () => {
      renderTimeline(failedStatus);
      
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  describe('size variants', () => {
    it('applies sm size via data-size', () => {
      renderTimeline(null, { size: 'sm' });
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveAttribute('data-size', 'sm');
    });

    it('applies lg size via data-size', () => {
      renderTimeline(null, { size: 'lg' });
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveAttribute('data-size', 'lg');
    });

    it('defaults to md size', () => {
      renderTimeline(null);
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveAttribute('data-size', 'md');
    });
  });

  describe('custom className', () => {
    it('applies custom className', () => {
      renderTimeline(null, { className: 'my-custom-class' });
      
      const timeline = screen.getByTestId('job-status-timeline');
      expect(timeline).toHaveClass('my-custom-class');
    });
  });

  describe('DEFAULT_STEPS', () => {
    it('has correct default steps with i18n keys', () => {
      expect(DEFAULT_STEPS).toEqual([
        { id: 'queued', label: 'nav:job_queued' },
        { id: 'processing', label: 'nav:job_processing' },
        { id: 'completed', label: 'nav:job_completed', failedLabel: 'nav:job_failed' },
      ]);
    });
  });

  describe('i18n', () => {
    it('renders Czech labels when language is cs', () => {
      testI18n.changeLanguage('cs');
      renderTimeline(null);
      
      expect(screen.getByText('Fronta')).toBeInTheDocument();
      expect(screen.getByText('Zpracování')).toBeInTheDocument();
      expect(screen.getByText('Hotovo')).toBeInTheDocument();
      
      testI18n.changeLanguage('en'); // reset
    });
  });
});
