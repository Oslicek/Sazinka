import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('Blog setup', () => {
  test('content config exists', () => {
    const fullPath = resolve(__dirname, '../../content.config.ts');
    expect(existsSync(fullPath)).toBe(true);
  });

  test('has at least one blog post for each locale', () => {
    const locales = ['en', 'cs', 'sk'];
    for (const locale of locales) {
      const dir = resolve(__dirname, `../../content/blog/${locale}`);
      const posts = readdirSync(dir).filter((name) => name.endsWith('.md'));
      expect(posts.length, `No blog posts for locale: ${locale}`).toBeGreaterThan(0);
    }
  });

  test('blog pages exist for each locale', () => {
    const pages = [
      '../en/blog/index.astro',
      '../en/blog/[slug].astro',
      '../cs/blog/index.astro',
      '../cs/blog/[slug].astro',
      '../sk/blog/index.astro',
      '../sk/blog/[slug].astro',
    ];

    for (const page of pages) {
      const fullPath = resolve(__dirname, page);
      expect(existsSync(fullPath), `Missing page: ${page}`).toBe(true);
    }
  });

  test('sample EN post has required frontmatter fields', () => {
    const path = resolve(__dirname, '../../content/blog/en/2026-02-10-getting-started.md');
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toContain('title:');
    expect(raw).toContain('description:');
    expect(raw).toContain('date:');
    expect(raw).toContain('locale: en');
  });
});
