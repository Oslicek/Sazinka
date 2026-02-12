import { describe, expect, test } from 'vitest';
import { onRequestPost as contactPost } from '../api/contact';
import { onRequestPost as newsletterPost } from '../api/newsletter';
import { onRequestGet as newsletterConfirmGet } from '../api/newsletter-confirm';

describe('POST /api/contact', () => {
  test('returns ticketId for valid payload', async () => {
    const request = new Request('https://ariadline.com/api/contact', {
      method: 'POST',
      body: JSON.stringify({
        email: 'john@doe.com',
        message: 'Hello',
        website: '',
      }),
    });
    const response = await contactPost({ request });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.ticketId).toMatch(/^REQ-\d{4}-\d{6}$/);
  });

  test('returns fake success for honeypot', async () => {
    const request = new Request('https://ariadline.com/api/contact', {
      method: 'POST',
      body: JSON.stringify({
        email: 'john@doe.com',
        message: 'Hello',
        website: 'spam',
      }),
    });
    const response = await contactPost({ request });
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.ticketId).toBeUndefined();
  });
});

describe('POST /api/newsletter', () => {
  test('returns pendingConfirmation for valid payload', async () => {
    const request = new Request('https://ariadline.com/api/newsletter', {
      method: 'POST',
      body: JSON.stringify({
        email: 'john@doe.com',
        gdprConsent: true,
        website: '',
      }),
    });
    const response = await newsletterPost({ request });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pendingConfirmation).toBe(true);
    expect(typeof body.token).toBe('string');
  });
});

describe('GET /api/newsletter/confirm', () => {
  test('returns 400 for missing token', async () => {
    const request = new Request('https://ariadline.com/api/newsletter/confirm');
    const response = await newsletterConfirmGet({ request });
    expect(response.status).toBe(400);
  });

  test('returns HTML for present token', async () => {
    const request = new Request('https://ariadline.com/api/newsletter/confirm?token=abc');
    const response = await newsletterConfirmGet({ request });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Newsletter subscription confirmed');
  });
});
