import { describe, it, expect, beforeAll, vi } from 'vitest';

// Restore real react-i18next (global setup mocks it)
vi.unmock('react-i18next');

import { render, screen, act } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import enNav from '../../public/locales/en/nav.json';
import csNav from '../../public/locales/cs/nav.json';

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

// ── Mock router ──
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

// ── Mock stores ──
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ isConnected: true }),
}));

vi.mock('@/stores/activeJobsStore', () => ({
  useActiveJobsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeCount: 0 }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      user: { id: '1', name: 'Test User', role: 'customer', email: 'test@test.com', locale: 'en' },
      logout: vi.fn(),
      hasPermission: () => true,
    }),
}));

import { Layout } from './Layout';

function renderLayout(lng = 'en') {
  testI18n.changeLanguage(lng);
  return render(
    <I18nextProvider i18n={testI18n}>
      <Layout><div>Content</div></Layout>
    </I18nextProvider>,
  );
}

describe('Layout i18n', () => {
  it('renders English navigation labels', () => {
    renderLayout('en');
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Routes')).toBeInTheDocument();
    expect(screen.getByText('Jobs')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Work Log')).toBeInTheDocument();
  });

  it('renders Czech navigation labels', () => {
    renderLayout('cs');
    expect(screen.getByText('Kalendář')).toBeInTheDocument();
    expect(screen.getByText('Zákazníci')).toBeInTheDocument();
    expect(screen.getByText('Nastavení')).toBeInTheDocument();
    expect(screen.getByText('Trasy')).toBeInTheDocument();
    expect(screen.getByText('Úlohy')).toBeInTheDocument();
    expect(screen.getByText('Plán')).toBeInTheDocument();
    expect(screen.getByText('Záznam')).toBeInTheDocument();
  });

  it('renders Online/Offline status in English', () => {
    renderLayout('en');
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('renders Log out button in English', () => {
    renderLayout('en');
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  it('renders Odhlásit button in Czech', () => {
    renderLayout('cs');
    expect(screen.getByText('Odhlásit')).toBeInTheDocument();
  });

  it('does not contain hardcoded Czech when in English', () => {
    renderLayout('en');
    expect(screen.queryByText('Kalendář')).not.toBeInTheDocument();
    expect(screen.queryByText('Zákazníci')).not.toBeInTheDocument();
    expect(screen.queryByText('Nastavení')).not.toBeInTheDocument();
    expect(screen.queryByText('Odhlásit')).not.toBeInTheDocument();
  });

  it('switches language dynamically', () => {
    const { rerender } = renderLayout('en');
    expect(screen.getByText('Calendar')).toBeInTheDocument();

    act(() => { testI18n.changeLanguage('cs'); });
    rerender(
      <I18nextProvider i18n={testI18n}>
        <Layout><div>Content</div></Layout>
      </I18nextProvider>,
    );
    expect(screen.getByText('Kalendář')).toBeInTheDocument();
  });

  it('nav namespace has matching keys in en and cs', () => {
    const enKeys = Object.keys(enNav).sort();
    const csKeys = Object.keys(csNav).sort();
    expect(enKeys).toEqual(csKeys);
  });
});
