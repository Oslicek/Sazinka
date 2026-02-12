import { describe, test, expect } from 'vitest';
import { getTranslation, getLocaleFromPath, getLocalizedPath, LOCALES } from '../utils';

describe('getTranslation(locale, key)', () => {
  test('returns correct translation for "en"', () => {
    const result = getTranslation('en', 'nav.home');
    expect(result).toBe('Home');
  });

  test('returns correct translation for "cs"', () => {
    const result = getTranslation('cs', 'nav.home');
    expect(result).toBe('Domů');
  });

  test('returns correct translation for "sk"', () => {
    const result = getTranslation('sk', 'nav.home');
    expect(result).toBe('Domov');
  });

  test('returns nested key value', () => {
    const result = getTranslation('en', 'hero.title');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns key itself for missing translation key', () => {
    const result = getTranslation('en', 'nonexistent.key');
    expect(result).toBe('nonexistent.key');
  });
});

describe('getLocaleFromPath(path)', () => {
  test('extracts "en" from /en/features', () => {
    expect(getLocaleFromPath('/en/features')).toBe('en');
  });

  test('extracts "cs" from /cs/pricing', () => {
    expect(getLocaleFromPath('/cs/pricing')).toBe('cs');
  });

  test('extracts "sk" from /sk/blog', () => {
    expect(getLocaleFromPath('/sk/blog')).toBe('sk');
  });

  test('returns "en" for root /', () => {
    expect(getLocaleFromPath('/')).toBe('en');
  });

  test('returns "en" for unknown locale prefix', () => {
    expect(getLocaleFromPath('/de/features')).toBe('en');
  });

  test('handles paths with trailing slash', () => {
    expect(getLocaleFromPath('/cs/')).toBe('cs');
  });
});

describe('getLocalizedPath(locale, path)', () => {
  test('prefixes path with locale', () => {
    expect(getLocalizedPath('cs', '/features')).toBe('/cs/features');
  });

  test('replaces existing locale prefix', () => {
    expect(getLocalizedPath('sk', '/en/features')).toBe('/sk/features');
  });

  test('handles root path', () => {
    expect(getLocalizedPath('en', '/')).toBe('/en/');
  });

  test('preserves path segments', () => {
    expect(getLocalizedPath('cs', '/blog/my-post')).toBe('/cs/blog/my-post');
  });
});

describe('LOCALES constant', () => {
  test('contains exactly en, cs, sk', () => {
    expect(LOCALES).toEqual(['en', 'cs', 'sk']);
  });
});
