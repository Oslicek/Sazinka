import { describe, test, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { existsSync } from 'fs';
import { resolve } from 'path';

import EnFeaturesPage from '../en/features.astro';
import EnPricingPage from '../en/pricing.astro';
import EnPrivacyPage from '../en/legal/privacy.astro';
import EnTermsPage from '../en/legal/terms.astro';
import EnCookiesPage from '../en/legal/cookies.astro';

describe('Features page', () => {
  test('renders routing, CRM and calendar sections', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(EnFeaturesPage);
    expect(html).toContain('Smart Route Planning');
    expect(html).toContain('Customer Management');
    expect(html).toContain('Calendar');
  });
});

describe('Pricing page', () => {
  test('renders Free and Pro tiers', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(EnPricingPage);
    expect(html).toContain('Free');
    expect(html).toContain('Pro');
  });

  test('contains CTA link to app.ariadline.com', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(EnPricingPage);
    expect(html).toContain('https://app.ariadline.com');
  });
});

describe('Legal pages', () => {
  test('render privacy, terms and cookies pages', async () => {
    const container = await AstroContainer.create();
    const privacy = await container.renderToString(EnPrivacyPage);
    const terms = await container.renderToString(EnTermsPage);
    const cookies = await container.renderToString(EnCookiesPage);

    expect(privacy).toContain('Privacy');
    expect(terms).toContain('Terms');
    expect(cookies).toContain('Cookie');
  });

  test('all locales have privacy, terms, and cookies pages', () => {
    const pages = [
      'en/legal/privacy.astro',
      'en/legal/terms.astro',
      'en/legal/cookies.astro',
      'cs/legal/privacy.astro',
      'cs/legal/terms.astro',
      'cs/legal/cookies.astro',
      'sk/legal/privacy.astro',
      'sk/legal/terms.astro',
      'sk/legal/cookies.astro',
    ];

    for (const page of pages) {
      const fullPath = resolve(__dirname, '..', page);
      expect(existsSync(fullPath), `Missing page: ${page}`).toBe(true);
    }
  });
});
