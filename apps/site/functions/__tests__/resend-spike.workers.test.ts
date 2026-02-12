import { describe, expect, test } from 'vitest';
import { Resend } from 'resend';

describe('Resend SDK spike in workers runtime', () => {
  test('Resend constructor works in workerd runtime', () => {
    expect(() => new Resend('re_test_key')).not.toThrow();
  });

  test('emails API object exists', () => {
    const resend = new Resend('re_test_key');
    expect(resend.emails).toBeDefined();
    expect(typeof resend.emails.send).toBe('function');
  });
});
