import { describe, expect, test } from 'vitest';
import { onRequestGet } from '../index';

function makeRequest(path: string, acceptLanguage?: string): Request {
  const headers = new Headers();
  if (acceptLanguage) headers.set('accept-language', acceptLanguage);
  return new Request(`https://ariadline.com${path}`, { headers });
}

describe('GET / — edge language redirect', () => {
  test('redirects to /en/ when no Accept-Language header', async () => {
    const res = await onRequestGet({ request: makeRequest('/') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/en/');
  });

  test('redirects to /cs/ for Czech browser', async () => {
    const res = await onRequestGet({ request: makeRequest('/', 'cs,en;q=0.5') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/cs/');
  });

  test('redirects to /sk/ for Slovak browser', async () => {
    const res = await onRequestGet({ request: makeRequest('/', 'sk-SK,sk;q=0.9,en;q=0.5') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/sk/');
  });

  test('redirects to /en/ for unsupported language', async () => {
    const res = await onRequestGet({ request: makeRequest('/', 'de-DE,de;q=0.9') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/en/');
  });

  test('picks highest-quality supported locale', async () => {
    const res = await onRequestGet({ request: makeRequest('/', 'de;q=0.9,cs;q=0.8,en;q=0.5') });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/cs/');
  });

  test('sets Vary: Accept-Language header', async () => {
    const res = await onRequestGet({ request: makeRequest('/') });
    expect(res.headers.get('vary')).toBe('Accept-Language');
  });

  test('sets no-cache header to prevent stale redirects', async () => {
    const res = await onRequestGet({ request: makeRequest('/') });
    expect(res.headers.get('cache-control')).toContain('no-cache');
  });
});
