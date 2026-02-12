import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import Header from '../Header.astro';

async function renderHeader(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(Header, {
    props: {
      locale: 'en',
      currentPath: '/en/',
      ...props,
    },
  });
}

describe('Header.astro', () => {
  test('renders logo with Ariadline text', async () => {
    const html = await renderHeader();
    expect(html).toContain('Ariadline');
  });

  test('renders navigation links for all main pages', async () => {
    const html = await renderHeader();
    expect(html).toContain('/en/');
    expect(html).toContain('/en/features');
    expect(html).toContain('/en/pricing');
    expect(html).toContain('/en/contact');
    expect(html).toContain('/en/blog');
  });

  test('navigation links use correct locale prefix for cs', async () => {
    const html = await renderHeader({ locale: 'cs' });
    expect(html).toContain('/cs/');
    expect(html).toContain('/cs/features');
    expect(html).toContain('/cs/pricing');
    expect(html).toContain('/cs/contact');
    expect(html).toContain('/cs/blog');
  });

  test('renders CTA button linking to app.ariadline.com', async () => {
    const html = await renderHeader();
    expect(html).toContain('app.ariadline.com');
  });

  test('renders language switcher with 3 locale options', async () => {
    const html = await renderHeader({ currentPath: '/en/features' });
    // Should have links for en, cs, sk
    expect(html).toContain('/en/features');
    expect(html).toContain('/cs/features');
    expect(html).toContain('/sk/features');
  });

  test('renders nav element', async () => {
    const html = await renderHeader();
    expect(html).toContain('<nav');
  });
});
