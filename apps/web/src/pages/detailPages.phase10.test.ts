/**
 * Phase 10 — Detail Pages: single-column CSS rule verification.
 *
 * Verifies that the canonical 1023px responsive rule is present in each
 * detail page CSS module, superseding old 900px/768px/600px rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '.');

function readCss(filename: string): string {
  return readFileSync(resolve(ROOT, filename), 'utf-8');
}

const TABLET_BREAKPOINT = '@media (max-width: 1023px)';

describe('Phase 10 — detail page CSS canonical breakpoint', () => {
  const files = [
    'CustomerDetail.module.css',
    'RevisionDetail.module.css',
    'VisitDetail.module.css',
    'WorkItemDetail.module.css',
  ];

  for (const file of files) {
    it(`${file}: has canonical 1023px responsive rule`, () => {
      const css = readCss(file);
      expect(css).toContain(TABLET_BREAKPOINT);
    });
  }
});
