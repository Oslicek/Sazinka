/**
 * Build script for design tokens.
 * Reads tokens.json and generates variables.css with CSS custom properties.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname, '../tokens.json');
const outputPath = resolve(__dirname, '../variables.css');

interface TokenGroup {
  [key: string]: string;
}

interface Tokens {
  [group: string]: TokenGroup;
}

function buildCSS(tokens: Tokens): string {
  const lines: string[] = [
    '/* Auto-generated from tokens.json — do not edit manually */',
    '/* Run `pnpm --filter @ariadline/design-tokens build` to regenerate */',
    '',
    ':root {',
  ];

  for (const [group, values] of Object.entries(tokens)) {
    lines.push(`  /* ${group} */`);
    for (const [key, value] of Object.entries(values)) {
      lines.push(`  --${group}-${key}: ${value};`);
    }
    lines.push('');
  }

  // Remove trailing empty line before closing brace
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

const tokens: Tokens = JSON.parse(readFileSync(tokensPath, 'utf-8'));
const css = buildCSS(tokens);
writeFileSync(outputPath, css, 'utf-8');
console.log(`✓ Generated ${outputPath}`);
