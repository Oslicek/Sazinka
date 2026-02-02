import { type JobStatus, isQueued, isProcessing, isFailed } from '../../types/jobStatus';
import styles from './JobStatusTimeline.module.css';

/** Timeline step definition */
export interface TimelineStep {
  /** Unique identifier matching status type or custom stage */
  id: string;
  /** Label to show when step is active/pending */
  label: string;
  /** Label to show when job failed at this step */
  failedLabel?: string;
}

/** Default steps for most job types */
export const DEFAULT_STEPS: TimelineStep[] = [
  { id: 'queued', label: 'Fronta' },
  { id: 'processing', label: 'Zpracování' },
  { id: 'completed', label: 'Hotovo', failedLabel: 'Selhalo' },
];

/** Props for JobStatusTimeline component */
export interface JobStatusTimelineProps {
  /** Current job status */
  status: JobStatus | null;
  /** Custom steps (defaults to queued → processing → completed) */
  steps?: TimelineStep[];
  /** Show progress bar during processing */
  showProgress?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS class */
  className?: string;
}

/**
 * Visual timeline showing job progress through states
 * 
 * Displays a horizontal timeline with dots/checkmarks for each step.
 * Steps can be: pending, active, done, or error.
 * 
 * @example
 * ```tsx
 * <JobStatusTimeline
 *   status={{ type: 'processing', progress: 50, message: 'Building...' }}
 *   showProgress
 * />
 * ```
 */
export function JobStatusTimeline({
  status,
  steps = DEFAULT_STEPS,
  showProgress = true,
  size = 'md',
  className = '',
}: JobStatusTimelineProps) {
  // Determine current step index based on status
  const getCurrentStepIndex = (): number => {
    if (!status) return -1;
    
    switch (status.type) {
      case 'queued':
        return steps.findIndex(s => s.id === 'queued');
      case 'processing':
        return steps.findIndex(s => s.id === 'processing');
      case 'completed':
        return steps.length - 1; // Last step
      case 'failed':
        return steps.length - 1; // Failed at last step
      default:
        return -1;
    }
  };
  
  const currentIndex = getCurrentStepIndex();
  const isFail = status && isFailed(status);
  
  // Get step state for rendering
  const getStepState = (index: number): 'pending' | 'active' | 'done' | 'error' => {
    if (!status) return 'pending';
    
    if (isFail && index === steps.length - 1) {
      return 'error';
    }
    
    if (status.type === 'completed') {
      return 'done';
    }
    
    if (index < currentIndex) {
      return 'done';
    }
    
    if (index === currentIndex) {
      return 'active';
    }
    
    return 'pending';
  };
  
  // Get additional info to display
  const getStepInfo = (): { text?: string; type: 'info' | 'error' } => {
    if (!status) return { type: 'info' };
    
    if (isQueued(status) && status.position) {
      return { text: `Pozice: ${status.position}`, type: 'info' };
    }
    
    if (isProcessing(status) && status.message) {
      return { text: status.message, type: 'info' };
    }
    
    if (isFailed(status)) {
      return { text: status.error, type: 'error' };
    }
    
    return { type: 'info' };
  };
  
  const info = getStepInfo();
  const showProgressBar = showProgress && isProcessing(status) && status.progress !== undefined;
  
  return (
    <div 
      className={`${styles.timeline} ${styles[size]} ${className}`}
      data-testid="job-status-timeline"
      data-size={size}
    >
      {/* Steps */}
      <div className={styles.steps}>
        {steps.map((step, index) => {
          const state = getStepState(index);
          const isLastStep = index === steps.length - 1;
          const showFailedLabel = isLastStep && isFail && step.failedLabel;
          
          return (
            <div
              key={step.id}
              className={`${styles.step} ${styles[state]}`}
              data-testid="timeline-step"
              data-state={state}
            >
              {/* Connector line (not for first step) */}
              {index > 0 && (
                <div 
                  className={`${styles.connector} ${state === 'pending' ? '' : styles.connectorDone}`}
                />
              )}
              
              {/* Step dot/checkmark */}
              <div 
                className={styles.dot}
                data-testid={`step-${step.id}`}
                data-state={state}
              >
                {state === 'done' && (
                  <svg className={styles.checkmark} viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                )}
                {state === 'error' && (
                  <svg className={styles.errorIcon} viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
                  </svg>
                )}
                {state === 'active' && (
                  <div className={styles.pulse} />
                )}
              </div>
              
              {/* Step label */}
              <div className={styles.label}>
                {showFailedLabel ? step.failedLabel : step.label}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Progress bar */}
      {showProgressBar && status && isProcessing(status) && (
        <div className={styles.progressContainer}>
          <div 
            className={styles.progressBar}
            role="progressbar"
            aria-valuenow={status.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ width: `${status.progress}%` }}
          />
          <span className={styles.progressText}>{status.progress}%</span>
        </div>
      )}
      
      {/* Info message */}
      {info.text && (
        <div className={`${styles.info} ${info.type === 'error' ? styles.infoError : ''}`}>
          {info.text}
        </div>
      )}
    </div>
  );
}
