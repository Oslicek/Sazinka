import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import Hero from '../Hero.astro';

async function renderHero(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(Hero, {
    props: { locale: 'en', ...props },
  });
}

describe('Hero.astro', () => {
  test('renders headline from translations', async () => {
    const html = await renderHero();
    expect(html).toContain('Untangle your workday');
  });

  test('renders subtitle from translations', async () => {
    const html = await renderHero();
    expect(html).toContain('Route planning and CRM');
  });

  test('renders CTA button with link to registration', async () => {
    const html = await renderHero();
    expect(html).toContain('app.ariadline.com');
    expect(html).toContain('Try for free');
  });

  test('renders localized content for cs', async () => {
    const html = await renderHero({ locale: 'cs' });
    expect(html).toContain('Rozmotat');
    expect(html).toContain('Vyzkoušet zdarma');
  });

  test('renders hero section element', async () => {
    const html = await renderHero();
    expect(html).toContain('hero');
  });
});
