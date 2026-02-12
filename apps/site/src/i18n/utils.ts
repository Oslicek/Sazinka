import en from './en.json';
import cs from './cs.json';
import sk from './sk.json';

export const LOCALES = ['en', 'cs', 'sk'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

const translations: Record<Locale, Record<string, unknown>> = { en, cs, sk };

/**
 * Get a translated string by dot-separated key path.
 * Returns the key itself if the translation is not found.
 *
 * @example getTranslation('en', 'nav.home') → "Home"
 * @example getTranslation('cs', 'hero.title') → "Rozmotat váš pracovní den."
 */
export function getTranslation(locale: Locale, key: string): string {
  const parts = key.split('.');
  let value: unknown = translations[locale];

  for (const part of parts) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return key;
    }
    value = (value as Record<string, unknown>)[part];
  }

  if (typeof value === 'string') {
    return value;
  }

  return key;
}

/**
 * Extract the locale from a URL path.
 * Falls back to DEFAULT_LOCALE if the path doesn't start with a known locale prefix.
 *
 * @example getLocaleFromPath('/cs/pricing') → 'cs'
 * @example getLocaleFromPath('/') → 'en'
 */
export function getLocaleFromPath(path: string): Locale {
  const segments = path.split('/').filter(Boolean);
  const first = segments[0];

  if (first && (LOCALES as readonly string[]).includes(first)) {
    return first as Locale;
  }

  return DEFAULT_LOCALE;
}

/**
 * Generate a localized path. Strips any existing locale prefix and prepends the given locale.
 *
 * @example getLocalizedPath('cs', '/features') → '/cs/features'
 * @example getLocalizedPath('sk', '/en/features') → '/sk/features'
 * @example getLocalizedPath('en', '/') → '/en/'
 */
export function getLocalizedPath(locale: Locale, path: string): string {
  const segments = path.split('/').filter(Boolean);

  // Remove existing locale prefix if present
  if (segments.length > 0 && (LOCALES as readonly string[]).includes(segments[0])) {
    segments.shift();
  }

  const rest = segments.length > 0 ? segments.join('/') : '';
  return `/${locale}/${rest}`;
}

/**
 * Get all translations for a given locale.
 * Useful for passing the entire translation object to React components via props.
 */
export function getTranslations(locale: Locale): Record<string, unknown> {
  return translations[locale];
}
