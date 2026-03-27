/**
 * A.5 — i18n completeness for last visit comment keys in planner namespace.
 *
 * Keys must exist in en, cs, sk planner.json and must not be raw key fallbacks.
 */
import { describe, it, expect } from 'vitest';

import enPlanner from '../../../../public/locales/en/planner.json';
import csPlanner from '../../../../public/locales/cs/planner.json';
import skPlanner from '../../../../public/locales/sk/planner.json';

const REQUIRED_KEYS = [
  'timeline_stop_comment_label',
  'timeline_stop_comment_follow_up',
] as const;

const LOCALES = [
  { locale: 'en', json: enPlanner as Record<string, string> },
  { locale: 'cs', json: csPlanner as Record<string, string> },
  { locale: 'sk', json: skPlanner as Record<string, string> },
];

describe('planner i18n — last visit comment keys', () => {
  // A.5.1 All required keys exist in en, cs, sk
  it('has all required keys in every locale', () => {
    for (const { locale, json } of LOCALES) {
      for (const key of REQUIRED_KEYS) {
        expect(json, `${locale} missing key "${key}"`).toHaveProperty(key);
      }
    }
  });

  // A.5.2 Values are not raw key fallbacks
  it('values are not equal to the raw key strings', () => {
    for (const { locale, json } of LOCALES) {
      for (const key of REQUIRED_KEYS) {
        const value = json[key];
        expect(value, `${locale}["${key}"] must not be the raw key`).not.toBe(key);
        expect(value?.trim().length, `${locale}["${key}"] must not be empty`).toBeGreaterThan(0);
      }
    }
  });
});
