import { useTranslation } from 'react-i18next';
import styles from './StepIndicator.module.css';

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps?: number;
  onStepClick?: (step: number) => void;
}

const STEP_KEYS = [
  'step_indicator.step1',
  'step_indicator.step2',
  'step_indicator.step3',
  'step_indicator.step4',
  'step_indicator.step5',
] as const;

export function StepIndicator({ currentStep, totalSteps = 5, onStepClick }: StepIndicatorProps) {
  const { t } = useTranslation('onboarding');

  return (
    <nav className={styles.root} aria-label="Onboarding progress">
      <ol className={styles.steps}>
        {STEP_KEYS.slice(0, totalSteps).map((key, idx) => {
          const step = idx + 1;
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;
          const isFuture = step > currentStep;

          return (
            <li
              key={step}
              className={[
                styles.step,
                isCompleted ? styles.completed : '',
                isCurrent ? styles.current : '',
                isFuture ? styles.future : '',
              ].join(' ')}
            >
              {idx > 0 && <span className={styles.line} aria-hidden="true" />}

              <button
                type="button"
                className={styles.circle}
                onClick={isCompleted && onStepClick ? () => onStepClick(step) : undefined}
                disabled={!isCompleted}
                aria-label={`${t(key)}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isCompleted ? (
                  <span aria-hidden="true">✓</span>
                ) : (
                  <span aria-hidden="true">{step}</span>
                )}
              </button>

              <span className={styles.label}>{t(key)}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
