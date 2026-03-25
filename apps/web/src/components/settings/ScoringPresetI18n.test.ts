/**
 * i18n completeness tests for scoring preset names.
 *
 * Preset name keys must exist in BOTH settings.json (for Settings page)
 * and planner.json (for InboxFilterBar dropdown). Values must match
 * PRJ_PLAN.MD §2.2 and be consistent across the two namespaces.
 */
import { describe, it, expect } from 'vitest';

import enSettings from '../../../public/locales/en/settings.json';
import csSettings from '../../../public/locales/cs/settings.json';
import skSettings from '../../../public/locales/sk/settings.json';
import enPlanner from '../../../public/locales/en/planner.json';
import csPlanner from '../../../public/locales/cs/planner.json';
import skPlanner from '../../../public/locales/sk/planner.json';

const PRESET_KEYS = [
  'standard',
  'new_customers_first',
  'due_date_radar',
  'overdue_firefighter',
  'data_quality_first',
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

const NAMESPACES = [
  { ns: 'settings', locales: [
    { code: 'en', json: enSettings },
    { code: 'cs', json: csSettings },
    { code: 'sk', json: skSettings },
  ]},
  { ns: 'planner', locales: [
    { code: 'en', json: enPlanner },
    { code: 'cs', json: csPlanner },
    { code: 'sk', json: skPlanner },
  ]},
] as const;

describe('scoring preset i18n completeness', () => {
  for (const { ns, locales } of NAMESPACES) {
    describe(`namespace: ${ns}`, () => {
      for (const { code, json } of locales) {
        describe(`locale: ${code}`, () => {
          for (const presetKey of PRESET_KEYS) {
            const i18nKey = `scoring_preset_name_${presetKey}`;

            it(`has key ${i18nKey}`, () => {
              expect(Object.prototype.hasOwnProperty.call(json, i18nKey)).toBe(true);
            });

            it(`${i18nKey} is not the raw key string`, () => {
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
  }

  describe('settings and planner values match', () => {
    for (const presetKey of PRESET_KEYS) {
      const i18nKey = `scoring_preset_name_${presetKey}`;

      it(`en: ${i18nKey} identical in both namespaces`, () => {
        expect((enSettings as Record<string, string>)[i18nKey])
          .toBe((enPlanner as Record<string, string>)[i18nKey]);
      });

      it(`cs: ${i18nKey} identical in both namespaces`, () => {
        expect((csSettings as Record<string, string>)[i18nKey])
          .toBe((csPlanner as Record<string, string>)[i18nKey]);
      });

      it(`sk: ${i18nKey} identical in both namespaces`, () => {
        expect((skSettings as Record<string, string>)[i18nKey])
          .toBe((skPlanner as Record<string, string>)[i18nKey]);
      });
    }
  });
});
