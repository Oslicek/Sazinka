import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('BUG-9/BUG-10: ChecklistFilterDropdown checkbox CSS guard', () => {
  it('uses sr-only input + .checkboxFace visual (not native paint) and selected rows', () => {
    const css = readFileSync(
      resolve(__dirname, '..', 'ChecklistFilterDropdown.module.css'),
      'utf-8'
    );

    expect(css).toMatch(/\.checkboxInput\s*\{/);
    expect(css).toMatch(/\.checkboxFace\s*\{/);
    expect(css).toMatch(/\.valueRow\[data-selected='true'\]\s+\.checkboxFace/);
    expect(css).toMatch(/\.valueRow\[data-selected=['"]true['"]\]\s*\{/);
  });
});
