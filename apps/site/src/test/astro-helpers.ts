import {
  experimental_AstroContainer as AstroContainer,
  type ContainerRenderOptions,
} from 'astro/container';

type AstroComponentFactory = Parameters<AstroContainer['renderToString']>[0];

/**
 * Render an Astro component to an HTML string for testing.
 * Uses the Container API (experimental, stable since Astro 4.9).
 */
export async function renderAstro(
  Component: AstroComponentFactory,
  options: ContainerRenderOptions = {},
): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(Component, options);
}

/**
 * Render an Astro component and parse the result into a DocumentFragment.
 * Requires a DOM environment (jsdom / happy-dom) — use the
 * `// @vitest-environment jsdom` pragma in your test file.
 */
export async function renderAstroToDOM(
  Component: AstroComponentFactory,
  options: ContainerRenderOptions = {},
): Promise<DocumentFragment> {
  const html = await renderAstro(Component, options);
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}
