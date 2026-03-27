import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('BUG-9: ChecklistFilterDropdown checkbox CSS guard', () => {
  it('defines explicit checkbox override so global input width does not hide labels', () => {
    const css = readFileSync(
      resolve(__dirname, '..', 'ChecklistFilterDropdown.module.css'),
      'utf-8'
    );

    expect(css).toMatch(/\.valueRow\s+input\[type=['"]checkbox['"]\]\s*\{/);
    expect(css).toMatch(
      /\.valueRow\s+input\[type=['"]checkbox['"]\][\s\S]*?width:\s*auto\s*;/
    );
  });
});
