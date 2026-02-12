import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import Footer from '../Footer.astro';

async function renderFooter(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(Footer, {
    props: {
      locale: 'en',
      ...props,
    },
  });
}

describe('Footer.astro', () => {
  test('renders legal page links (Privacy, Terms, Cookies)', async () => {
    const html = await renderFooter();
    expect(html).toContain('/en/legal/privacy');
    expect(html).toContain('/en/legal/terms');
    expect(html).toContain('/en/legal/cookies');
  });

  test('renders copyright with Ariadline', async () => {
    const html = await renderFooter();
    expect(html).toContain('Ariadline');
    expect(html).toContain(new Date().getFullYear().toString());
  });

  test('legal links use correct locale prefix for cs', async () => {
    const html = await renderFooter({ locale: 'cs' });
    expect(html).toContain('/cs/legal/privacy');
    expect(html).toContain('/cs/legal/terms');
    expect(html).toContain('/cs/legal/cookies');
  });

  test('renders footer element', async () => {
    const html = await renderFooter();
    expect(html).toContain('<footer');
  });

  test('renders newsletter slot area', async () => {
    const html = await renderFooter();
    // Footer should have a section for newsletter
    expect(html).toContain('newsletter');
  });
});
