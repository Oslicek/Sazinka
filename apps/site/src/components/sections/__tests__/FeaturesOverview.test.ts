import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';
import FeaturesOverview from '../FeaturesOverview.astro';

async function renderSection(props: Record<string, unknown> = {}) {
  const container = await AstroContainer.create();
  return container.renderToString(FeaturesOverview, {
    props: { locale: 'en', ...props },
  });
}

describe('FeaturesOverview.astro', () => {
  test('renders 3 feature cards', async () => {
    const html = await renderSection();
    expect(html).toContain('Smart Route Planning');
    expect(html).toContain('Customer Management');
    expect(html).toContain('Calendar');
  });

  test('each card has a description', async () => {
    const html = await renderSection();
    expect(html).toContain('Automatic optimization');
    expect(html).toContain('All your customers');
    expect(html).toContain('Plan your week');
  });

  test('feature content is localized', async () => {
    const html = await renderSection({ locale: 'cs' });
    expect(html).toContain('Chytré plánování tras');
    expect(html).toContain('Správa zákazníků');
    expect(html).toContain('Kalendář a plánování');
  });
});
