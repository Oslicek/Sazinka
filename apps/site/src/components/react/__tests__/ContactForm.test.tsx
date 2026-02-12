// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContactForm from '../ContactForm';

const labels = {
  email: 'Your email',
  message: 'Message',
  submit: 'Send message',
  sending: 'Sending...',
  success: 'Message sent!',
  error: 'Something went wrong.',
};

describe('ContactForm', () => {
  test('renders email, message, and submit button', () => {
    render(<ContactForm labels={labels} locale="en" />);
    expect(screen.getByLabelText('Your email')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  test('renders hidden honeypot field', () => {
    render(<ContactForm labels={labels} locale="en" />);
    const honeypot = screen.getByLabelText('Website');
    expect(honeypot).toBeInTheDocument();
  });

  test('submits valid data and shows success', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true, ticketId: 'REQ-2026-000001' });
    render(<ContactForm labels={labels} locale="en" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'john@doe.com' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/REQ-2026-000001/)).toBeInTheDocument();
  });

  test('shows validation errors for invalid input', async () => {
    render(<ContactForm labels={labels} locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
      expect(screen.getByText('Message is required')).toBeInTheDocument();
    });
  });
});
