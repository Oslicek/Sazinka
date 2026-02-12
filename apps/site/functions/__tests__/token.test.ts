import { describe, expect, test } from 'vitest';
import { generateConfirmToken } from '../lib/token';

describe('generateConfirmToken', () => {
  test('returns non-empty token string', () => {
    const token = generateConfirmToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
  });

  test('returns different tokens', () => {
    const first = generateConfirmToken();
    const second = generateConfirmToken();
    expect(first).not.toBe(second);
  });
});
