import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import RootIndex from '../index.astro';

describe('Root index.astro (/) — static fallback', () => {
  test('contains meta refresh fallback to /en/', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RootIndex);
    expect(html).toContain('url=/en/');
  });

  test('contains JS redirect with navigator.language', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RootIndex);
    expect(html).toContain('navigator.language');
    expect(html).toContain('/cs/');
    expect(html).toContain('/sk/');
  });

  test('has no visible body content', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RootIndex);
    expect(html).toMatch(/<body[^>]*>\s*<\/body>/);
  });
});
