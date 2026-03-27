/**
 * Strip Markdown syntax from a string without collapsing newlines.
 * Suitable for use inside `extractLastVisitComment` where intra-note line
 * structure should be preserved.
 */
export function stripMarkdownFormatting(md: string): string {
  if (!md) return '';

  let text = md;

  // Fenced code blocks: ```...```
  text = text.replace(/```[\s\S]*?```/g, (m) =>
    m.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, ''),
  );

  // Headings: # ## ###
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes: > text
  text = text.replace(/^>\s+/gm, '');

  // Unordered lists: - * +
  text = text.replace(/^[\-*+]\s+/gm, '');

  // Ordered lists: 1. 2.
  text = text.replace(/^\d+\.\s+/gm, '');

  // Strikethrough: ~~text~~
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Bold + italic: ***text***
  text = text.replace(/\*{3}([^*]+)\*{3}/g, '$1');

  // Bold: **text** or __text__
  text = text.replace(/\*{2}([^*]+)\*{2}/g, '$1');
  text = text.replace(/_{2}([^_]+)_{2}/g, '$1');

  // Italic: *text* or _text_
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // Images: ![alt](url) — keep alt text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Links: [text](url) — keep text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, '$1');

  // Horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  return text.trim();
}

/**
 * Strip Markdown formatting AND collapse all whitespace to a single space.
 * Suitable for compact, single-line excerpts in timeline cards and
 * `StopCommentBlock`.
 * Does NOT truncate — that is a UI concern.
 */
export function stripMarkdown(md: string): string {
  if (!md) return '';
  return stripMarkdownFormatting(md).replace(/\s+/g, ' ').trim();
}
