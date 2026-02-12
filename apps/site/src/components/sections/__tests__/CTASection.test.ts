import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import CTASection from '../CTASection.astro';

async function renderSection(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(CTASection, {
    props: { locale: 'en', ...props },
  });
}

describe('CTASection.astro', () => {
  test('renders call-to-action title', async () => {
    const html = await renderSection();
    expect(html).toContain('Ready to untangle');
  });

  test('renders CTA button linking to app', async () => {
    const html = await renderSection();
    expect(html).toContain('app.ariadline.com');
    expect(html).toContain('Start for free');
  });

  test('renders localized for cs', async () => {
    const html = await renderSection({ locale: 'cs' });
    expect(html).toContain('Připraveni rozmotat');
    expect(html).toContain('Začít zdarma');
  });
});
