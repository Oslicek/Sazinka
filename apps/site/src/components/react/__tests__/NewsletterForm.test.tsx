// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewsletterForm from '../NewsletterForm';

const labels = {
  emailPlaceholder: 'your@email.com',
  subscribe: 'Subscribe',
  subscribing: 'Subscribing...',
  gdprConsent: 'I agree to receive newsletter.',
  success: 'Check your email to confirm subscription.',
  error: 'Something went wrong.',
};

describe('NewsletterForm', () => {
  test('renders email input, consent checkbox and submit button', () => {
    render(<NewsletterForm labels={labels} locale="en" variant="full" />);
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByLabelText('I agree to receive newsletter.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
  });

  test('shows validation error when consent is not checked', async () => {
    render(<NewsletterForm labels={labels} locale="en" variant="full" />);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'john@doe.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    await waitFor(() => {
      expect(screen.getByText('Consent is required')).toBeInTheDocument();
    });
  });

  test('submits valid data and shows success message', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true, pendingConfirmation: true });
    render(<NewsletterForm labels={labels} locale="en" variant="full" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'john@doe.com' } });
    fireEvent.click(screen.getByLabelText('I agree to receive newsletter.'));
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText('Check your email to confirm subscription.')).toBeInTheDocument();
    });
  });
});
