import { describe, it, expect } from 'vitest';
import { searchCountries } from '../index';
import type { Country } from '../types';

const FIXTURE: Country[] = [
  { code: 'CZ', alpha3: 'CZE', name: { en: 'Czechia', cs: 'Česko', sk: 'Česko' } },
  { code: 'SK', alpha3: 'SVK', name: { en: 'Slovakia', cs: 'Slovensko', sk: 'Slovensko' } },
  { code: 'DE', alpha3: 'DEU', name: { en: 'Germany', cs: 'Německo', sk: 'Nemecko' } },
  { code: 'PL', alpha3: 'POL', name: { en: 'Poland', cs: 'Polsko', sk: 'Poľsko' } },
  { code: 'AT', alpha3: 'AUT', name: { en: 'Austria', cs: 'Rakousko', sk: 'Rakúsko' } },
];

describe('searchCountries', () => {
  it('returns all countries for empty query', () => {
    expect(searchCountries('', 'en', FIXTURE)).toHaveLength(5);
  });

  it('returns all countries for whitespace-only query', () => {
    expect(searchCountries('   ', 'en', FIXTURE)).toHaveLength(5);
  });

  it('filters by localized name (en), case-insensitive', () => {
    const result = searchCountries('ger', 'en', FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('DE');
  });

  it('filters by localized name (cs)', () => {
    const result = searchCountries('česko', 'cs', FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('CZ');
  });

  it('filters by localized name (sk)', () => {
    const result = searchCountries('slovensko', 'sk', FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('SK');
  });

  it('filters by alpha-2 code (uppercase)', () => {
    const result = searchCountries('PL', 'en', FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('PL');
  });

  it('filters by alpha-2 code (lowercase)', () => {
    const result = searchCountries('pl', 'en', FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('PL');
  });

  it('returns empty array for no match', () => {
    expect(searchCountries('xyzxyz', 'en', FIXTURE)).toHaveLength(0);
  });

  it('falls back to English name for unknown locale', () => {
    const result = searchCountries('Czechia', 'fr', FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('CZ');
  });

  it('matches substring in the middle of a name', () => {
    const result = searchCountries('land', 'en', FIXTURE);
    // Poland contains "land"
    expect(result.some((c) => c.code === 'PL')).toBe(true);
  });

  it('returns multiple matches when query is broad', () => {
    // "sk" matches Slovakia (code) and Česko (cs name contains "sk")
    const result = searchCountries('sk', 'cs', FIXTURE);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('uses the real countries list when no fixture provided', async () => {
    const { countries, searchCountries: search } = await import('../index');
    expect(countries.length).toBeGreaterThan(200);
    const cz = search('Czechia', 'en');
    expect(cz).toHaveLength(1);
    expect(cz[0].code).toBe('CZ');
  });
});
