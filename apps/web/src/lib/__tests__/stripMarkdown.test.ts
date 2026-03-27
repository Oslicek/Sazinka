/**
 * Phase 3 RED tests: stripMarkdown utility — S1–S15 from the TDD plan.
 */
import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '../stripMarkdown';

describe('stripMarkdown', () => {
  // S1
  it('S1: strips bold (**text**)', () => {
    expect(stripMarkdown('**bold**')).toBe('bold');
  });

  it('S1b: strips bold (__text__)', () => {
    expect(stripMarkdown('__bold__')).toBe('bold');
  });

  // S2
  it('S2: strips italic (*text*)', () => {
    expect(stripMarkdown('*italic*')).toBe('italic');
  });

  it('S2b: strips italic (_text_)', () => {
    expect(stripMarkdown('_italic_')).toBe('italic');
  });

  // S3
  it('S3: strips headings', () => {
    expect(stripMarkdown('## Heading')).toBe('Heading');
  });

  it('S3b: strips h1', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
  });

  // S4
  it('S4: strips links, keeping text', () => {
    expect(stripMarkdown('[text](https://example.com)')).toBe('text');
  });

  // S5
  it('S5: strips images, keeping alt text', () => {
    expect(stripMarkdown('![alt text](image.png)')).toBe('alt text');
  });

  // S6
  it('S6: strips inline code', () => {
    expect(stripMarkdown('`code`')).toBe('code');
  });

  // S7
  it('S7: strips fenced code blocks', () => {
    expect(stripMarkdown('```\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  // S8
  it('S8: strips unordered list markers', () => {
    expect(stripMarkdown('- item one')).toBe('item one');
  });

  it('S8b: strips * list markers', () => {
    expect(stripMarkdown('* item')).toBe('item');
  });

  // S9
  it('S9: strips ordered list numbers', () => {
    expect(stripMarkdown('1. first item')).toBe('first item');
  });

  // S10
  it('S10: collapses multiple whitespace/newlines to single space', () => {
    expect(stripMarkdown('line one\n\nline two')).toBe('line one line two');
  });

  // S11
  it('S11: returns empty string for empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });

  // S12
  it('S12: returns empty string for null input', () => {
    expect(stripMarkdown(null as unknown as string)).toBe('');
  });

  it('S12b: returns empty string for undefined input', () => {
    expect(stripMarkdown(undefined as unknown as string)).toBe('');
  });

  // S13
  it('S13: returns plain text unchanged (no markdown)', () => {
    expect(stripMarkdown('Plain text without markdown')).toBe('Plain text without markdown');
  });

  // S14
  it('S14: strips strikethrough', () => {
    expect(stripMarkdown('~~struck~~')).toBe('struck');
  });

  // S15
  it('S15: strips blockquotes', () => {
    expect(stripMarkdown('> quote text')).toBe('quote text');
  });

  // Extra: mixed markdown
  it('strips complex mixed markdown', () => {
    const md = '# Title\n\n**Bold** and *italic* with [link](url)\n\n> A quote\n\n- item';
    const result = stripMarkdown(md);
    expect(result).not.toContain('#');
    expect(result).not.toContain('**');
    expect(result).not.toContain('[link](url)');
    expect(result).toContain('Bold');
    expect(result).toContain('italic');
    expect(result).toContain('Title');
  });
});
