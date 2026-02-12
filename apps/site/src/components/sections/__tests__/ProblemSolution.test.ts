import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import ProblemSolution from '../ProblemSolution.astro';

async function renderSection(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(ProblemSolution, {
    props: { locale: 'en', ...props },
  });
}

describe('ProblemSolution.astro', () => {
  test('renders "problem" section with translated text', async () => {
    const html = await renderSection();
    expect(html).toContain('Spending evenings planning routes');
  });

  test('renders "solution" section with translated text', async () => {
    const html = await renderSection();
    expect(html).toContain('Ariadline does it in seconds');
  });

  test('renders localized content for cs', async () => {
    const html = await renderSection({ locale: 'cs' });
    expect(html).toContain('Trávíte večery plánováním tras');
    expect(html).toContain('Ariadline to zvládne za vteřinu');
  });
});
