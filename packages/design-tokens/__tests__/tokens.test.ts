import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname, '../tokens.json');
const cssPath = resolve(__dirname, '../variables.css');

interface Tokens {
  color: Record<string, string>;
  font: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
}

function readTokens(): Tokens {
  return JSON.parse(readFileSync(tokensPath, 'utf-8'));
}

function readCSS(): string {
  return readFileSync(cssPath, 'utf-8');
}

describe('tokens.json', () => {
  test('contains required primary color', () => {
    const tokens = readTokens();
    expect(tokens.color.primary).toBe('#2563eb');
    expect(tokens.color['primary-dark']).toBe('#1d4ed8');
  });

  test('contains accent color (#D97706 gold)', () => {
    const tokens = readTokens();
    expect(tokens.color.accent).toBe('#D97706');
    expect(tokens.color['accent-light']).toBe('#F59E0B');
  });

  test('contains neutral colors', () => {
    const tokens = readTokens();
    expect(tokens.color.secondary).toBeDefined();
    expect(tokens.color.bg).toBeDefined();
    expect(tokens.color['bg-secondary']).toBeDefined();
    expect(tokens.color.border).toBeDefined();
    expect(tokens.color.text).toBeDefined();
    expect(tokens.color['text-secondary']).toBeDefined();
  });

  test('contains semantic colors', () => {
    const tokens = readTokens();
    expect(tokens.color.success).toBeDefined();
    expect(tokens.color.warning).toBeDefined();
    expect(tokens.color.error).toBeDefined();
  });

  test('contains font definitions', () => {
    const tokens = readTokens();
    expect(tokens.font.body).toContain('Inter');
    expect(tokens.font.heading).toContain('Montserrat');
  });

  test('contains radius definitions', () => {
    const tokens = readTokens();
    expect(tokens.radius.sm).toBe('4px');
    expect(tokens.radius.md).toBe('8px');
    expect(tokens.radius.lg).toBe('12px');
  });

  test('contains shadow definitions', () => {
    const tokens = readTokens();
    expect(tokens.shadow.sm).toBeDefined();
    expect(tokens.shadow.md).toBeDefined();
    expect(tokens.shadow.lg).toBeDefined();
  });
});

describe('variables.css', () => {
  test('contains :root selector', () => {
    const css = readCSS();
    expect(css).toContain(':root {');
  });

  test('contains all color CSS custom properties', () => {
    const css = readCSS();
    expect(css).toContain('--color-primary: #2563eb');
    expect(css).toContain('--color-primary-dark: #1d4ed8');
    expect(css).toContain('--color-accent: #D97706');
    expect(css).toContain('--color-accent-light: #F59E0B');
    expect(css).toContain('--color-secondary:');
    expect(css).toContain('--color-bg:');
    expect(css).toContain('--color-text:');
    expect(css).toContain('--color-success:');
    expect(css).toContain('--color-warning:');
    expect(css).toContain('--color-error:');
  });

  test('contains font CSS custom properties', () => {
    const css = readCSS();
    expect(css).toContain('--font-body:');
    expect(css).toContain('--font-heading:');
  });

  test('contains radius CSS custom properties', () => {
    const css = readCSS();
    expect(css).toContain('--radius-sm: 4px');
    expect(css).toContain('--radius-md: 8px');
    expect(css).toContain('--radius-lg: 12px');
  });

  test('contains shadow CSS custom properties', () => {
    const css = readCSS();
    expect(css).toContain('--shadow-sm:');
    expect(css).toContain('--shadow-md:');
    expect(css).toContain('--shadow-lg:');
  });
});
