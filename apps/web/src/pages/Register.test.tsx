import { describe, it, expect, beforeAll, vi } from 'vitest';

// Restore real react-i18next (global setup mocks it)
vi.unmock('react-i18next');

import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import enAuth from '../../public/locales/en/auth.json';
import csAuth from '../../public/locales/cs/auth.json';

// ── i18n test instance ──
const testI18n = i18next.createInstance();

beforeAll(async () => {
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'cs'],
    ns: ['auth'],
    defaultNS: 'auth',
    resources: {
      en: { auth: enAuth },
      cs: { auth: csAuth },
    },
    interpolation: { escapeValue: false },
  });
});

// ── Mock router ──
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

// ── Mock stores ──
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      register: vi.fn(),
      error: null,
    }),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ isConnected: true }),
}));

import { Register } from './Register';

function renderRegister(lng = 'en') {
  testI18n.changeLanguage(lng);
  return render(
    <I18nextProvider i18n={testI18n}>
      <Register />
    </I18nextProvider>,
  );
}

describe('Register page i18n', () => {
  it('renders English text by default', () => {
    renderRegister('en');
    expect(screen.getByText('Create a new account')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('renders Czech text when locale selector is set to cs', () => {
    renderRegister('en');
    // Change locale selector to Czech
    const select = screen.getByLabelText('Language');
    fireEvent.change(select, { target: { value: 'cs' } });

    expect(screen.getByText('Vytvoření nového účtu')).toBeInTheDocument();
    expect(screen.getByLabelText('Jméno')).toBeInTheDocument();
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zaregistrovat se' })).toBeInTheDocument();
    expect(screen.getByText('Máte již účet?')).toBeInTheDocument();
    expect(screen.getByText('Přihlaste se')).toBeInTheDocument();
  });

  it('has a locale selector with en and cs options', () => {
    renderRegister('en');
    const select = screen.getByLabelText('Language');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('en');

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveValue('en');
    expect(options[0]).toHaveTextContent('English');
    expect(options[1]).toHaveValue('cs');
    expect(options[1]).toHaveTextContent('Čeština');
  });

  it('switches form language when locale selector changes', () => {
    renderRegister('en');
    expect(screen.getByText('Create a new account')).toBeInTheDocument();

    const select = screen.getByLabelText('Language');
    fireEvent.change(select, { target: { value: 'cs' } });

    // After locale change, the form should re-render in Czech
    expect(screen.getByText('Vytvoření nového účtu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zaregistrovat se' })).toBeInTheDocument();
  });

  it('shows locale confirmation hint', () => {
    renderRegister('en');
    expect(screen.getByText('You can change the language later in Settings.')).toBeInTheDocument();
  });

  it('has correct placeholder text', () => {
    renderRegister('en');
    expect(screen.getByPlaceholderText('John Smith')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Minimum 8 characters')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Acme Ltd.')).toBeInTheDocument();
  });

  it('auth namespace has matching keys in en and cs', () => {
    const enKeys = Object.keys(enAuth).sort();
    const csKeys = Object.keys(csAuth).sort();
    expect(enKeys).toEqual(csKeys);
  });
});
