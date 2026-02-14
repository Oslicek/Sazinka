import { describe, it, expect, beforeAll } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resolveBackendMessage } from './resolveBackendMessage';

// Create a test i18n instance with known translations
const testI18n = i18n.createInstance();

beforeAll(async () => {
  await testI18n
    .use(initReactI18next)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'cs'],
      ns: ['common', 'jobs'],
      defaultNS: 'common',
      resources: {
        en: {
          common: {
            loading: 'Loading…',
            errors: {
              unknown: 'An unexpected error occurred',
            },
          },
          jobs: {
            loading_customers: 'Loading {{count}} customers',
          },
        },
        cs: {
          common: {
            loading: 'Načítám…',
            errors: {
              unknown: 'Došlo k neočekávané chybě',
            },
          },
          jobs: {
            loading_customers: 'Načítám {{count}} zákazníků',
          },
        },
      },
      interpolation: { escapeValue: false },
    });
});

describe('resolveBackendMessage', () => {
  it('should pass through legacy plain strings unchanged', () => {
    const result = resolveBackendMessage('Načítám...', testI18n);
    expect(result).toBe('Načítám...');
  });

  it('should pass through empty string', () => {
    const result = resolveBackendMessage('', testI18n);
    expect(result).toBe('');
  });

  it('should translate { key, params } shape', () => {
    const result = resolveBackendMessage(
      { key: 'common:loading', params: {} },
      testI18n,
    );
    expect(result).toBe('Loading…');
  });

  it('should translate with interpolation params', () => {
    const result = resolveBackendMessage(
      { key: 'jobs:loading_customers', params: { count: 42 } },
      testI18n,
    );
    expect(result).toBe('Loading 42 customers');
  });

  it('should handle missing params gracefully', () => {
    const result = resolveBackendMessage(
      { key: 'common:loading' },
      testI18n,
    );
    expect(result).toBe('Loading…');
  });

  it('should return generic fallback for unknown key', () => {
    const result = resolveBackendMessage(
      { key: 'unknown:missing_key' },
      testI18n,
    );
    expect(result).toBe('An unexpected error occurred');
  });

  it('should not throw for any input', () => {
    expect(() => resolveBackendMessage('test', testI18n)).not.toThrow();
    expect(() => resolveBackendMessage({ key: 'x:y' }, testI18n)).not.toThrow();
    expect(() => resolveBackendMessage({ key: '' }, testI18n)).not.toThrow();
  });

  it('should translate in Czech when i18n language is cs', async () => {
    await testI18n.changeLanguage('cs');
    const result = resolveBackendMessage(
      { key: 'common:loading', params: {} },
      testI18n,
    );
    expect(result).toBe('Načítám…');
    // Reset
    await testI18n.changeLanguage('en');
  });
});
