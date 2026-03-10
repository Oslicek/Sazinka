/**
 * Phase 13 — Breakpoint Consolidation: verify no ad-hoc breakpoints remain.
 *
 * After consolidation, the only @media breakpoint values in CSS files should be
 * the canonical ones: 639px, 1023px, 1024px.
 * Old ad-hoc values 600px, 767px, 768px, 769px, 900px must not appear in @media rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const SRC = resolve(__dirname, '.');

function walkCss(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkCss(full));
    } else if (entry.endsWith('.module.css')) {
      results.push(full);
    }
  }
  return results;
}

const AD_HOC_PATTERN = /@media[^{]*(?:600|767|768|769|900)px/g;

describe('Phase 13 — breakpoint consolidation', () => {
  it('no CSS module contains ad-hoc breakpoints (600/767/768/769/900px in @media)', () => {
    const violations: string[] = [];

    for (const file of walkCss(SRC)) {
      const css = readFileSync(file, 'utf-8');
      const matches = css.match(AD_HOC_PATTERN);
      if (matches) {
        const rel = file.replace(SRC + '/', '');
        violations.push(`${rel}: ${matches.join(', ')}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ad-hoc breakpoints in ${violations.length} file(s):\n` +
        violations.map((v) => `  - ${v}`).join('\n')
      );
    }
  });
});
