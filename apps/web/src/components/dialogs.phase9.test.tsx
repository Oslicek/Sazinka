/**
 * Phase 9 — Dialogs & Drawers: full-screen sheet CSS verification.
 *
 * Verifies that the canonical 639px full-screen sheet rule is present in each
 * dialog/drawer CSS module. Actual rendering is covered by visual/manual testing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

function readCss(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

const PHONE_BREAKPOINT = '@media (max-width: 639px)';
const TABLET_BREAKPOINT = '@media (max-width: 1023px)';

describe('Phase 9 — dialog/drawer CSS full-screen sheet rules', () => {
  const files: { name: string; path: string }[] = [
    { name: 'ScheduleDialog', path: 'components/common/ScheduleDialog.module.css' },
    { name: 'CustomerEditDrawer', path: 'components/customers/CustomerEditDrawer.module.css' },
    { name: 'QuickVisitDialog', path: 'components/worklog/QuickVisitDialog.module.css' },
    { name: 'CompleteRevisionDialog', path: 'components/revisions/CompleteRevisionDialog.module.css' },
    { name: 'DeleteAccountDialog', path: 'components/settings/DeleteAccountDialog.module.css' },
  ];

  for (const { name, path } of files) {
    it(`${name}: has phone full-screen sheet rule (max-width: 639px)`, () => {
      const css = readCss(path);
      expect(css).toContain(PHONE_BREAKPOINT);
    });

    it(`${name}: has tablet responsive rule (max-width: 1023px)`, () => {
      const css = readCss(path);
      expect(css).toContain(TABLET_BREAKPOINT);
    });
  }
});
