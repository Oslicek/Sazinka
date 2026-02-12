import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getContainerRenderer as reactRenderer } from '@astrojs/react';
import { loadRenderers } from 'astro:container';

import ContactPageEn from '../en/contact.astro';

describe('Contact page', () => {
  test('renders contact page title and description', async () => {
    const renderers = await loadRenderers([reactRenderer()]);
    const container = await AstroContainer.create({ renderers });
    const html = await container.renderToString(ContactPageEn);
    expect(html).toContain('Contact Us');
    expect(html).toContain("Have a question? We'd love to hear from you.");
  });

  test('uses React islands with client:visible for forms', () => {
    const source = readFileSync(resolve(__dirname, '../en/contact.astro'), 'utf-8');
    expect(source).toMatch(/<ContactForm[\s\S]*client:visible/);
    expect(source).toMatch(/<NewsletterForm[\s\S]*client:visible/);
  });

  test('all locales have contact page', () => {
    const locales = ['en', 'cs', 'sk'];
    for (const locale of locales) {
      const fullPath = resolve(__dirname, '..', `${locale}/contact.astro`);
      expect(readFileSync(fullPath, 'utf-8').length > 0).toBe(true);
    }
  });
});
