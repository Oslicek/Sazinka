import { describe, it, expect } from 'vitest';
import { renderAstro } from '../test/astro-helpers';

// Import pages to test
import EnIndex from '../pages/en/index.astro';
import EnFeatures from '../pages/en/features.astro';
import EnPricing from '../pages/en/pricing.astro';

/**
 * Static accessibility checks for WCAG 2.1 AA compliance
 * These tests check HTML structure without requiring a DOM environment
 */

describe('Accessibility (WCAG 2.1 AA - Static Analysis)', () => {
  describe('Landing page (en)', () => {
    it('has semantic HTML5 landmarks', async () => {
      const html = await renderAstro(EnIndex, {});
      
      expect(html).toContain('<header');
      expect(html).toContain('<main');
      expect(html).toContain('<footer');
      expect(html).toContain('<nav');
    });

    it('has proper meta viewport for mobile', async () => {
      const html = await renderAstro(EnIndex, {});
      
      expect(html).toContain('name="viewport"');
      expect(html).toContain('width=device-width');
    });

    it('has lang attribute on html element', async () => {
      const html = await renderAstro(EnIndex, {});
      
      expect(html).toMatch(/<html[^>]+lang="en"/);
    });

    it('has proper heading hierarchy (h1)', async () => {
      const html = await renderAstro(EnIndex, {});
      
      const h1Count = (html.match(/<h1[^>]*>/g) || []).length;
      expect(h1Count).toBeGreaterThan(0);
      expect(h1Count).toBeLessThanOrEqual(1); // Only one h1 per page
    });

    it('has skip-to-content link for keyboard navigation', async () => {
      const html = await renderAstro(EnIndex, {});
      
      expect(html).toContain('href="#main-content"');
    });
  });

  describe('Features page (en)', () => {
    it('has semantic HTML5 landmarks', async () => {
      const html = await renderAstro(EnFeatures, {});
      
      expect(html).toContain('<header');
      expect(html).toContain('<main');
      expect(html).toContain('<footer');
    });

    it('has proper heading hierarchy', async () => {
      const html = await renderAstro(EnFeatures, {});
      
      const h1Count = (html.match(/<h1[^>]*>/g) || []).length;
      expect(h1Count).toBe(1);
    });
  });

  describe('Pricing page (en)', () => {
    it('has semantic HTML5 landmarks', async () => {
      const html = await renderAstro(EnPricing, {});
      
      expect(html).toContain('<header');
      expect(html).toContain('<main');
      expect(html).toContain('<footer');
    });

    it('has proper heading hierarchy', async () => {
      const html = await renderAstro(EnPricing, {});
      
      const h1Count = (html.match(/<h1[^>]*>/g) || []).length;
      expect(h1Count).toBe(1);
    });
  });
});

describe('Responsive Design - HTML Structure', () => {
  it('images have alt attributes', async () => {
    const html = await renderAstro(EnIndex, {});
    
    // Check that all <img> tags have alt attribute
    const imgMatches = html.match(/<img[^>]*>/g) || [];
    imgMatches.forEach((imgTag) => {
      expect(imgTag).toMatch(/alt=/);
    });
  });

  it('links avoid generic text patterns', async () => {
    const html = await renderAstro(EnIndex, {});
    
    // Check for bad patterns (case-insensitive)
    expect(html.toLowerCase()).not.toContain('>click here</a>');
    expect(html.toLowerCase()).not.toContain('>read more</a>');
  });

  it('has mobile-first responsive container classes', async () => {
    const html = await renderAstro(EnIndex, {});
    
    // Check for responsive container usage
    expect(html).toContain('class="container');
  });

  it('uses semantic section elements for content organization', async () => {
    const html = await renderAstro(EnIndex, {});
    
    expect(html).toContain('<section');
    const sectionCount = (html.match(/<section/g) || []).length;
    expect(sectionCount).toBeGreaterThan(0);
  });
});
