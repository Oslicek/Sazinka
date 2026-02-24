import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepIndicator } from './StepIndicator';

// Stub i18n so tests don't need the full translation setup
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'step_indicator.step1': 'Account',
        'step_indicator.step2': 'About you',
        'step_indicator.step3': 'Devices',
        'step_indicator.step4': 'Depot',
        'step_indicator.step5': 'All set!',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('StepIndicator', () => {
  it('renders 5 steps with labels', () => {
    render(<StepIndicator currentStep={1} />);
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('About you')).toBeTruthy();
    expect(screen.getByText('Devices')).toBeTruthy();
    expect(screen.getByText('Depot')).toBeTruthy();
    expect(screen.getByText('All set!')).toBeTruthy();
  });

  it('marks completed steps with checkmark', () => {
    render(<StepIndicator currentStep={3} />);
    // Steps 1 and 2 are completed → contain ✓
    const circles = screen.getAllByRole('button');
    expect(circles[0].textContent).toBe('✓');
    expect(circles[1].textContent).toBe('✓');
  });

  it('highlights current step with aria-current', () => {
    render(<StepIndicator currentStep={2} />);
    const currentBtn = screen.getByRole('button', { name: /About you.*current/i });
    expect(currentBtn.getAttribute('aria-current')).toBe('step');
  });

  it('makes completed steps clickable', () => {
    const onStepClick = vi.fn();
    render(<StepIndicator currentStep={3} onStepClick={onStepClick} />);
    const step1Btn = screen.getByRole('button', { name: /Account.*completed/i });
    fireEvent.click(step1Btn);
    expect(onStepClick).toHaveBeenCalledWith(1);
  });

  it('disables future steps', () => {
    render(<StepIndicator currentStep={1} />);
    const step3Btn = screen.getByRole('button', { name: /Devices/i });
    expect(step3Btn).toBeDisabled();
  });
});
