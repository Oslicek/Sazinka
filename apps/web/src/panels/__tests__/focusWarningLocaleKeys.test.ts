/**
 * Locale key presence tests for focus-customer warning banner (InboxListPanel).
 *
 * FWL-1: focus_customer_not_found present in en/planner.json
 * FWL-2: focus_customer_not_found present in cs/planner.json
 * FWL-3: focus_customer_not_found present in sk/planner.json
 * FWL-4: focus_customer_dismiss present in en/planner.json
 * FWL-5: focus_customer_dismiss present in cs/planner.json
 * FWL-6: focus_customer_dismiss present in sk/planner.json
 */
import { describe, it, expect } from 'vitest';
import en from '../../../public/locales/en/planner.json';
import cs from '../../../public/locales/cs/planner.json';
import sk from '../../../public/locales/sk/planner.json';

type Locale = Record<string, string>;

describe('planner locale keys – focus warning banner', () => {
  it('FWL-1: focus_customer_not_found exists in en', () => {
    expect((en as Locale)['focus_customer_not_found']).toBeTruthy();
  });

  it('FWL-2: focus_customer_not_found exists in cs', () => {
    expect((cs as Locale)['focus_customer_not_found']).toBeTruthy();
  });

  it('FWL-3: focus_customer_not_found exists in sk', () => {
    expect((sk as Locale)['focus_customer_not_found']).toBeTruthy();
  });

  it('FWL-4: focus_customer_dismiss exists in en', () => {
    expect((en as Locale)['focus_customer_dismiss']).toBeTruthy();
  });

  it('FWL-5: focus_customer_dismiss exists in cs', () => {
    expect((cs as Locale)['focus_customer_dismiss']).toBeTruthy();
  });

  it('FWL-6: focus_customer_dismiss exists in sk', () => {
    expect((sk as Locale)['focus_customer_dismiss']).toBeTruthy();
  });
});
