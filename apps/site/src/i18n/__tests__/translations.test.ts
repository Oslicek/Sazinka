import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const i18nDir = resolve(__dirname, '..');

const LOCALES = ['en', 'cs', 'sk'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadTranslations(locale: string): Record<string, any> {
  const raw = readFileSync(resolve(i18nDir, `${locale}.json`), 'utf-8');
  return JSON.parse(raw);
}

/** Recursively flatten nested keys: { a: { b: "x" } } → { "a.b": "x" } */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('translation files', () => {
  test('all three locale files exist and are valid JSON', () => {
    for (const locale of LOCALES) {
      expect(() => loadTranslations(locale)).not.toThrow();
    }
  });

  test('all locale files have the same set of keys', () => {
    const enKeys = flattenKeys(loadTranslations('en')).sort();
    const csKeys = flattenKeys(loadTranslations('cs')).sort();
    const skKeys = flattenKeys(loadTranslations('sk')).sort();

    expect(csKeys).toEqual(enKeys);
    expect(skKeys).toEqual(enKeys);
  });

  test('no translation value is empty string', () => {
    for (const locale of LOCALES) {
      const translations = loadTranslations(locale);
      const flat = flattenKeys(translations);
      for (const key of flat) {
        // Navigate to the value
        const parts = key.split('.');
        let value: unknown = translations;
        for (const part of parts) {
          value = (value as Record<string, unknown>)[part];
        }
        expect(value, `${locale}:${key} should not be empty`).not.toBe('');
      }
    }
  });

  test('en.json has required navigation keys', () => {
    const en = loadTranslations('en');
    expect(en.nav).toBeDefined();
    expect(en.nav.home).toBeDefined();
    expect(en.nav.features).toBeDefined();
    expect(en.nav.pricing).toBeDefined();
    expect(en.nav.contact).toBeDefined();
    expect(en.nav.blog).toBeDefined();
  });

  test('en.json has required hero keys', () => {
    const en = loadTranslations('en');
    expect(en.hero).toBeDefined();
    expect(en.hero.title).toBeDefined();
    expect(en.hero.subtitle).toBeDefined();
    expect(en.hero.cta).toBeDefined();
  });

  test('en.json has required meta keys', () => {
    const en = loadTranslations('en');
    expect(en.meta).toBeDefined();
    expect(en.meta.title).toBeDefined();
    expect(en.meta.description).toBeDefined();
  });
});
