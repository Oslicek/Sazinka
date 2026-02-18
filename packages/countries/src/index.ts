import rawData from '../countries.json' with { type: 'json' };
import type { Country } from './types';

export type { Country };

export const countries: Country[] = rawData as Country[];

/**
 * Search countries by localized name or alpha-2 code.
 *
 * @param query    Search string (case-insensitive substring match)
 * @param locale   Locale code for name lookup (e.g. "cs", "en", "sk")
 * @param list     Optional override list (defaults to the full countries list)
 */
export function searchCountries(
  query: string,
  locale: string,
  list: Country[] = countries
): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;

  return list.filter((c) => {
    const localizedName = (c.name[locale] ?? c.name['en'] ?? '').toLowerCase();
    return localizedName.includes(q) || c.code.toLowerCase().includes(q);
  });
}
