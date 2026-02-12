import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import RootIndex from '../index.astro';

describe('Root index.astro (/)', () => {
  let html: string;

  test('renders a script tag with navigator.language redirect logic', async () => {
    const container = await AstroContainer.create();
    html = await container.renderToString(RootIndex);
    expect(html).toContain('navigator.language');
  });

  test('contains meta refresh fallback to /en/ for no-JS', async () => {
    const container = await AstroContainer.create();
    html = await container.renderToString(RootIndex);
    expect(html).toContain('url=/en/');
  });

  test('script maps "cs" and "sk" to correct locale paths', async () => {
    const container = await AstroContainer.create();
    html = await container.renderToString(RootIndex);
    expect(html).toContain('/cs/');
    expect(html).toContain('/sk/');
  });
});
