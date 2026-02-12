import { describe, expect, test } from 'vitest';
import { contactSchema, newsletterSchema } from '../validation';

describe('contactSchema', () => {
  test('accepts valid contact payload', () => {
    const parsed = contactSchema.safeParse({
      email: 'john@doe.com',
      message: 'Hello',
      source: 'landing',
      locale: 'en',
      website: '',
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects invalid email', () => {
    const parsed = contactSchema.safeParse({
      email: 'wrong',
      message: 'Hello',
      website: '',
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects empty message', () => {
    const parsed = contactSchema.safeParse({
      email: 'john@doe.com',
      message: '',
      website: '',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('newsletterSchema', () => {
  test('accepts valid newsletter payload', () => {
    const parsed = newsletterSchema.safeParse({
      email: 'john@doe.com',
      gdprConsent: true,
      locale: 'en',
      website: '',
    });
    expect(parsed.success).toBe(true);
  });

  test('requires consent', () => {
    const parsed = newsletterSchema.safeParse({
      email: 'john@doe.com',
      gdprConsent: false,
      website: '',
    });
    expect(parsed.success).toBe(false);
  });
});
