// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContactForm from '../ContactForm';

// Mock @sazinka/countries for the site tests
vi.mock('@sazinka/countries', () => ({
  searchCountries: vi.fn((query: string, _locale: string, list: unknown[]) => {
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((c: any) =>
      (c.name?.en ?? '').toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }),
  countries: [
    { code: 'CZ', alpha3: 'CZE', name: { en: 'Czechia', cs: 'Česko', sk: 'Česko' } },
    { code: 'SK', alpha3: 'SVK', name: { en: 'Slovakia', cs: 'Slovensko', sk: 'Slovensko' } },
    { code: 'DE', alpha3: 'DEU', name: { en: 'Germany', cs: 'Německo', sk: 'Nemecko' } },
  ],
}));

const labels = {
  email: 'Your email',
  message: 'Message',
  country: 'Country',
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

  test('renders country dropdown', () => {
    render(<ContactForm labels={labels} locale="en" />);
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
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

  test('submits countryCode when country is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true, ticketId: 'REQ-2026-000002' });
    render(<ContactForm labels={labels} locale="en" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'john@doe.com' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello there' } });

    // Select country via the native select
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'CZ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ countryCode: 'CZ' })
      );
    });
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
