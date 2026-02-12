import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import Layout from '../Layout.astro';

async function renderLayout(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(Layout, {
    props: {
      title: 'Test Page — Ariadline',
      description: 'Test description for SEO.',
      locale: 'en',
      path: '/en/',
      ...props,
    },
    slots: { default: '<main><p>Test content</p></main>' },
  });
}

describe('Layout.astro', () => {
  test('renders <html> with correct lang attribute for "en"', async () => {
    const html = await renderLayout({ locale: 'en' });
    expect(html).toContain('<html lang="en"');
  });

  test('renders <html> with correct lang attribute for "cs"', async () => {
    const html = await renderLayout({ locale: 'cs' });
    expect(html).toContain('<html lang="cs"');
  });

  test('renders <title> from props', async () => {
    const html = await renderLayout({ title: 'My Custom Title' });
    expect(html).toContain('<title>My Custom Title</title>');
  });

  test('renders meta description from props', async () => {
    const html = await renderLayout({ description: 'My SEO description' });
    expect(html).toContain('<meta name="description" content="My SEO description"');
  });

  test('renders OG meta tags', async () => {
    const html = await renderLayout({
      title: 'OG Test',
      description: 'OG Description',
    });
    expect(html).toContain('property="og:title" content="OG Test"');
    expect(html).toContain('property="og:description" content="OG Description"');
    expect(html).toContain('property="og:type" content="website"');
  });

  test('renders Twitter Card meta tags', async () => {
    const html = await renderLayout();
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  test('renders canonical URL', async () => {
    const html = await renderLayout({ path: '/en/features' });
    expect(html).toContain('rel="canonical" href="https://ariadline.com/en/features"');
  });

  test('renders hreflang tags for all 3 locales', async () => {
    const html = await renderLayout({ path: '/en/features' });
    expect(html).toContain('hreflang="en" href="https://ariadline.com/en/features"');
    expect(html).toContain('hreflang="cs" href="https://ariadline.com/cs/features"');
    expect(html).toContain('hreflang="sk" href="https://ariadline.com/sk/features"');
    expect(html).toContain('hreflang="x-default" href="https://ariadline.com/en/features"');
  });

  test('renders Umami analytics script with defer attribute', async () => {
    const html = await renderLayout();
    expect(html).toContain('defer');
    expect(html).toContain('data-website-id');
  });

  test('renders slot content', async () => {
    const html = await renderLayout();
    expect(html).toContain('<p>Test content</p>');
  });

  test('includes viewport meta tag', async () => {
    const html = await renderLayout();
    expect(html).toContain('name="viewport"');
  });

  test('includes charset meta tag', async () => {
    const html = await renderLayout();
    expect(html).toContain('charset="utf-8"');
  });
});
