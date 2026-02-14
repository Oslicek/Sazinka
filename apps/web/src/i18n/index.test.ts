import { describe, it, expect, beforeAll, vi } from 'vitest';

// Restore real modules (global setup mocks them)
vi.unmock('react-i18next');
vi.unmock('@/i18n');

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Create a test-specific i18n instance (no HTTP backend, in-memory resources)
const testI18n = i18n.createInstance();

beforeAll(async () => {
  await testI18n
    .use(initReactI18next)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'en-GB', 'en-US', 'cs'],
      nonExplicitSupportedLngs: true,
      ns: ['common'],
      defaultNS: 'common',
      resources: {
        en: {
          common: {
            loading: 'Loading…',
            save: 'Save',
          },
        },
        cs: {
          common: {
            loading: 'Načítám…',
            save: 'Uložit',
          },
        },
      },
      interpolation: {
        escapeValue: false,
      },
    });
});

describe('i18n instance configuration', () => {
  it('should initialize successfully', () => {
    expect(testI18n.isInitialized).toBe(true);
  });

  it('should have fallbackLng set to en', () => {
    expect(testI18n.options.fallbackLng).toEqual(['en']);
  });

  it('should have supportedLngs including en, en-GB, en-US, cs', () => {
    const supportedLngs = testI18n.options.supportedLngs as string[];
    expect(supportedLngs).toContain('en');
    expect(supportedLngs).toContain('en-GB');
    expect(supportedLngs).toContain('en-US');
    expect(supportedLngs).toContain('cs');
  });

  it('should have nonExplicitSupportedLngs set to true', () => {
    expect(testI18n.options.nonExplicitSupportedLngs).toBe(true);
  });

  it('should resolve a language even without explicit lng', () => {
    // When no lng is set, i18n resolves language from resources/fallback
    expect(testI18n.language).toBeDefined();
    expect(typeof testI18n.language).toBe('string');
  });

  it('should change language successfully', async () => {
    await testI18n.changeLanguage('cs');
    expect(testI18n.language).toBe('cs');
  });

  it('should translate keys in English', async () => {
    await testI18n.changeLanguage('en');
    expect(testI18n.t('loading')).toBe('Loading…');
    expect(testI18n.t('save')).toBe('Save');
  });

  it('should translate keys in Czech', async () => {
    await testI18n.changeLanguage('cs');
    expect(testI18n.t('loading')).toBe('Načítám…');
    expect(testI18n.t('save')).toBe('Uložit');
  });

  it('should fall back to English for unsupported locale', async () => {
    await testI18n.changeLanguage('de');
    expect(testI18n.t('loading')).toBe('Loading…');
  });
});

describe('i18n production instance (index.ts)', () => {
  it('should export the production config with correct options', async () => {
    // Import the actual production instance to verify its configuration
    const prodI18n = (await import('./index')).default;

    // Verify options are set correctly (even if init hasn't completed due to HTTP)
    expect(prodI18n.options.fallbackLng).toEqual(['en']);
    expect(prodI18n.options.nonExplicitSupportedLngs).toBe(true);
    expect(prodI18n.options.lng).toBeUndefined();

    const supportedLngs = prodI18n.options.supportedLngs as string[];
    expect(supportedLngs).toContain('en');
    expect(supportedLngs).toContain('en-GB');
    expect(supportedLngs).toContain('en-US');
    expect(supportedLngs).toContain('cs');
  });
});
