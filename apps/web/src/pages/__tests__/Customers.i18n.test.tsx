/**
 * P0 (RED → GREEN) — Customers page i18n: filter_type_* translation keys.
 *
 * Tests 1–5: assert keys exist in all three locale files (fails RED until added).
 * Tests 6–7: component rendering asserts translated text is shown, not raw key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Locale files (loaded directly so tests fail RED when keys are absent) ────

import enCustomers from '../../../public/locales/en/customers.json';
import csCustomers from '../../../public/locales/cs/customers.json';
import skCustomers from '../../../public/locales/sk/customers.json';

type LocaleMap = Record<string, string>;

const EN = enCustomers as LocaleMap;
const CS = csCustomers as LocaleMap;
const SK = skCustomers as LocaleMap;

// ── i18n mock (uses actual locale JSON so rendering fails RED too) ────────────

let activeLocale: 'en' | 'cs' | 'sk' = 'en';
const localeMap: Record<string, LocaleMap> = { en: EN, cs: CS, sk: SK };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => localeMap[activeLocale]?.[key] ?? key,
    i18n: { language: activeLocale },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ── Component dependency mocks ────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: null }) => unknown) => {
    const state = { user: null };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/services/customerService', () => ({
  listCustomersExtended: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getCustomerSummary: vi.fn().mockResolvedValue(null),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  submitGeocodeJob: vi.fn(),
  subscribeToGeocodeJobStatus: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock('@/components/customers/AddCustomerForm', () => ({
  AddCustomerForm: () => <div data-testid="add-form" />,
}));

vi.mock('@/components/customers/CustomerTable', () => ({
  CustomerTable: () => <div data-testid="customer-table" />,
}));

vi.mock('@/components/customers/CustomerPreviewPanel', () => ({
  CustomerPreviewPanel: () => <div data-testid="preview-panel" />,
}));

vi.mock('@/components/customers/CustomerEditDrawer', () => ({
  CustomerEditDrawer: () => <div data-testid="edit-drawer" />,
}));


vi.mock('@/components/common/SplitView', () => ({
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">
      {panels.map((p) => (
        <div key={p.id}>{p.content}</div>
      ))}
    </div>
  ),
}));

import { Customers } from '../Customers';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCustomers() {
  return render(<Customers />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('P0: filter_type_* i18n keys', () => {
  beforeEach(() => {
    activeLocale = 'en';
    sessionStorage.clear();
    localStorage.clear();
  });

  // Tests 1–3: en locale key existence
  it('1. en locale has filter_type_all key', () => {
    expect(EN).toHaveProperty('filter_type_all');
    expect(EN.filter_type_all).not.toBe('filter_type_all');
    expect(EN.filter_type_all.length).toBeGreaterThan(0);
  });

  it('2. en locale has filter_type_company key', () => {
    expect(EN).toHaveProperty('filter_type_company');
    expect(EN.filter_type_company).not.toBe('filter_type_company');
    expect(EN.filter_type_company.length).toBeGreaterThan(0);
  });

  it('3. en locale has filter_type_person key', () => {
    expect(EN).toHaveProperty('filter_type_person');
    expect(EN.filter_type_person).not.toBe('filter_type_person');
    expect(EN.filter_type_person.length).toBeGreaterThan(0);
  });

  // Tests 4: cs locale key existence
  it('4a. cs locale has filter_type_all key', () => {
    expect(CS).toHaveProperty('filter_type_all');
    expect(CS.filter_type_all).not.toBe('filter_type_all');
  });

  it('4b. cs locale has filter_type_company key', () => {
    expect(CS).toHaveProperty('filter_type_company');
    expect(CS.filter_type_company).not.toBe('filter_type_company');
  });

  it('4c. cs locale has filter_type_person key', () => {
    expect(CS).toHaveProperty('filter_type_person');
    expect(CS.filter_type_person).not.toBe('filter_type_person');
  });

  // Tests 5: sk locale key existence
  it('5a. sk locale has filter_type_all key', () => {
    expect(SK).toHaveProperty('filter_type_all');
    expect(SK.filter_type_all).not.toBe('filter_type_all');
  });

  it('5b. sk locale has filter_type_company key', () => {
    expect(SK).toHaveProperty('filter_type_company');
    expect(SK.filter_type_company).not.toBe('filter_type_company');
  });

  it('5c. sk locale has filter_type_person key', () => {
    expect(SK).toHaveProperty('filter_type_person');
    expect(SK.filter_type_person).not.toBe('filter_type_person');
  });

  // Test 6: type filter dropdown removed in Phase 6B — i18n keys still exist in translations
  it('6. type filter dropdown no longer rendered in page (Phase 6B removal)', () => {
    activeLocale = 'en';
    renderCustomers();
    // The type filter SELECT is gone; no combobox with company option
    const selects = screen.queryAllByRole('combobox');
    const typeSelect = selects.find((el) =>
      Array.from(el.querySelectorAll('option')).some((o) => (o as HTMLOptionElement).value === 'company')
    );
    expect(typeSelect).toBeUndefined();
  });

  // Test 7: switching locale no longer shows type filter — test revision chips instead
  it('7. switching locale from en to cs changes revision chip labels', () => {
    activeLocale = 'en';
    const { rerender } = renderCustomers();
    // "All" revision chip text should be from EN translation, not raw key
    const allChip = screen.getByRole('button', { name: EN.filter_revision_all });
    expect(allChip).toBeInTheDocument();

    activeLocale = 'cs';
    rerender(<Customers />);
    // After locale switch, label should be from CS translation
    const allChipCs = screen.getByRole('button', { name: CS.filter_revision_all });
    expect(allChipCs).toBeInTheDocument();
  });
});
