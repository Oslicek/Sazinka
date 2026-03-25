/**
 * Phase A (RED) — i18n completeness tests for scoring preset names.
 *
 * These tests will FAIL until:
 *   - scoring_preset_name_* keys are added to cs/en/sk settings.json
 *   - The values match the localization table in PRJ_PLAN.MD §2.2
 */
import { describe, it, expect } from 'vitest';

// Import locale JSON files directly so we can check keys without a full i18n setup
import enSettings from '../../../public/locales/en/settings.json';
import csSettings from '../../../public/locales/cs/settings.json';
import skSettings from '../../../public/locales/sk/settings.json';

const PRESET_KEYS = [
  'standard',
  'new_customers_first',
  'due_date_radar',
  'overdue_firefighter',
  'data_quality_first',
] as const;

const LOCALES = [
  { code: 'en', json: enSettings },
  { code: 'cs', json: csSettings },
  { code: 'sk', json: skSettings },
] as const;

const EXPECTED: Record<string, Record<string, string>> = {
  en: {
    standard: 'Standard',
    new_customers_first: 'New Customers First',
    due_date_radar: 'Due-Date Radar',
    overdue_firefighter: 'Overdue Firefighter',
    data_quality_first: 'Data Quality First',
  },
  cs: {
    standard: 'Standardní',
    new_customers_first: 'Noví zákazníci první',
    due_date_radar: 'Radar termínů',
    overdue_firefighter: 'Krizový režim po termínu',
    data_quality_first: 'Kvalita dat a geokódingu',
  },
  sk: {
    standard: 'Štandardný',
    new_customers_first: 'Noví zákazníci prví',
    due_date_radar: 'Radar termínov',
    overdue_firefighter: 'Krízový režim po termíne',
    data_quality_first: 'Kvalita dát a geokódovania',
  },
};

describe('scoring preset i18n completeness', () => {
  for (const { code, json } of LOCALES) {
    describe(`locale: ${code}`, () => {
      for (const presetKey of PRESET_KEYS) {
        const i18nKey = `scoring_preset_name_${presetKey}`;

        it(`has key ${i18nKey}`, () => {
          expect(Object.prototype.hasOwnProperty.call(json, i18nKey)).toBe(true);
        });

        it(`${i18nKey} value is not the raw key string (not a missing-key fallback)`, () => {
          const value = (json as Record<string, string>)[i18nKey];
          expect(value).toBeTruthy();
          expect(value).not.toBe(i18nKey);
        });

        it(`${i18nKey} equals expected: "${EXPECTED[code][presetKey]}"`, () => {
          const value = (json as Record<string, string>)[i18nKey];
          expect(value).toBe(EXPECTED[code][presetKey]);
        });
      }
    });
  }
});
