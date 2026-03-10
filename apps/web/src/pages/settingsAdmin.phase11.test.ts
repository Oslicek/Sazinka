/**
 * Phase 11 — Settings & Admin: canonical breakpoint CSS verification.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '.');

function readCss(filename: string): string {
  return readFileSync(resolve(ROOT, filename), 'utf-8');
}

const TABLET_BREAKPOINT = '@media (max-width: 1023px)';

describe('Phase 11 — Settings & Admin CSS canonical breakpoint', () => {
  it('Settings.module.css: has canonical 1023px responsive rule', () => {
    expect(readCss('Settings.module.css')).toContain(TABLET_BREAKPOINT);
  });

  it('Admin.module.css: has canonical 1023px responsive rule', () => {
    expect(readCss('Admin.module.css')).toContain(TABLET_BREAKPOINT);
  });
});
