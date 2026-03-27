import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('BUG-9/BUG-10: ChecklistFilterDropdown checkbox CSS guard', () => {
  it('uses all:revert to undo global input styles, sets accent-color, and marks selected rows', () => {
    const css = readFileSync(
      resolve(__dirname, '..', 'ChecklistFilterDropdown.module.css'),
      'utf-8'
    );

    expect(css).toMatch(/\.valueRow\s+input\[type=['"]checkbox['"]\]\s*\{/);
    expect(css).toMatch(
      /\.valueRow\s+input\[type=['"]checkbox['"]\][\s\S]*?all:\s*revert\s*;/
    );
    expect(css).toMatch(
      /\.valueRow\s+input\[type=['"]checkbox['"]\][\s\S]*?accent-color:\s*var\(--color-primary,\s*#2563eb\)\s*;/
    );
    expect(css).toMatch(/\.valueRow\[data-selected=['"]true['"]\]\s*\{/);
  });
});
