import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, test, expect } from 'vitest';

describe('Astro Container API smoke test', () => {
  test('AstroContainer can be created', async () => {
    const container = await AstroContainer.create();
    expect(container).toBeDefined();
  });
});
