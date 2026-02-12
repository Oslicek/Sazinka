import { describe, expect, test } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import NotFoundPage from '../404.astro';

describe('404 page', () => {
  test('renders not found message and home links', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(NotFoundPage);
    expect(html).toContain('Page not found');
    expect(html).toContain('/en/');
    expect(html).toContain('/cs/');
    expect(html).toContain('/sk/');
  });
});
