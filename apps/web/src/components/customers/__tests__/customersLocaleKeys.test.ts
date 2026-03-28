/**
 * Phase 2 (RED → GREEN) — Locale key presence tests.
 *
 * L2-1: action_show_in_inbox present in en/customers.json
 * L2-2: action_show_in_inbox present in cs/customers.json
 * L2-3: action_show_in_inbox present in sk/customers.json
 */
import { describe, it, expect } from 'vitest';
import en from '../../../../public/locales/en/customers.json';
import cs from '../../../../public/locales/cs/customers.json';
import sk from '../../../../public/locales/sk/customers.json';

describe('customers locale keys – action_show_in_inbox', () => {
  it('L2-1: key exists in en/customers.json', () => {
    expect((en as Record<string, string>)['action_show_in_inbox']).toBeTruthy();
  });

  it('L2-2: key exists in cs/customers.json', () => {
    expect((cs as Record<string, string>)['action_show_in_inbox']).toBeTruthy();
  });

  it('L2-3: key exists in sk/customers.json', () => {
    expect((sk as Record<string, string>)['action_show_in_inbox']).toBeTruthy();
  });
});
