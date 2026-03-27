import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('BUG-9/BUG-10: ChecklistFilterDropdown checkbox CSS guard', () => {
  const css = readFileSync(
    resolve(__dirname, '..', 'ChecklistFilterDropdown.module.css'),
    'utf-8'
  );

  it('uses sr-only input + .checkboxFace visual (not native paint) and selected rows', () => {
    expect(css).toMatch(/\.checkboxInput\s*\{/);
    expect(css).toMatch(/\.checkboxFace\s*\{/);
    expect(css).toMatch(/\.valueRow\[data-selected='true'\]\s+\.checkboxFace/);
    expect(css).toMatch(/\.valueRow\[data-selected=['"]true['"]\]\s*\{/);
  });

  it('.checkboxFace uses !important on critical visual properties to survive cascade overrides', () => {
    expect(css).toMatch(/\.checkboxFace[\s\S]*?width:\s*16px\s*!important/);
    expect(css).toMatch(/\.checkboxFace[\s\S]*?height:\s*16px\s*!important/);
    expect(css).toMatch(/\.checkboxFace[\s\S]*?border:\s*2px solid[^;]*!important/);
  });

  it('.checkboxInput is visually hidden with !important overrides', () => {
    expect(css).toMatch(/\.checkboxInput[\s\S]*?opacity:\s*0/);
    expect(css).toMatch(/\.checkboxInput[\s\S]*?clip:\s*rect\(0/);
  });
});
