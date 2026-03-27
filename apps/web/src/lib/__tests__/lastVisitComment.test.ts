import { describe, it, expect } from 'vitest';
import { extractLastVisitComment } from '../lastVisitComment';
import { makeVisitFixture as makeVisit, makeWorkItemFixture as makeWorkItem } from '@/test-utils/visitFixtures';

describe('extractLastVisitComment', () => {
  // 1. No visits (null visit) -> null
  it('returns null when visit is null', () => {
    expect(extractLastVisitComment(null, [])).toBeNull();
  });

  // 2. Visit with fieldNotes, no work items -> trimmed plain text
  it('returns trimmed visit fieldNotes when present and no work items', () => {
    const visit = makeVisit({ fieldNotes: '  Kotel vyměněn  ' });
    expect(extractLastVisitComment(visit, [])).toBe('Kotel vyměněn');
  });

  // 3. fieldNotes whitespace only -> ignored
  it('returns null when fieldNotes is whitespace only and no work items have notes', () => {
    const visit = makeVisit({ fieldNotes: '   \n\t  ' });
    expect(extractLastVisitComment(visit, [])).toBeNull();
  });

  // 4. Visit fieldNotes empty, fallback to work-item resultNotes
  it('falls back to work-item resultNotes when visit fieldNotes is empty', () => {
    const visit = makeVisit({ fieldNotes: '' });
    const items = [makeWorkItem({ resultNotes: 'Filtr vyčištěn' })];
    expect(extractLastVisitComment(visit, items)).toBe('Filtr vyčištěn');
  });

  // 5. Fallback to work-item findings
  it('falls back to work-item findings when fieldNotes are empty', () => {
    const visit = makeVisit({ fieldNotes: undefined });
    const items = [makeWorkItem({ resultNotes: undefined, findings: 'Koroze na potrubí' })];
    expect(extractLastVisitComment(visit, items)).toBe('Koroze na potrubí');
  });

  // 6. Follow-up reason included when requiresFollowUp === true
  it('includes work-item followUpReason with ⚠ prefix when requiresFollowUp is true', () => {
    const visit = makeVisit({ fieldNotes: undefined });
    const items = [
      makeWorkItem({
        resultNotes: undefined,
        findings: undefined,
        requiresFollowUp: true,
        followUpReason: 'Nutná další návštěva',
      }),
    ];
    expect(extractLastVisitComment(visit, items)).toBe('⚠ Nutná další návštěva');
  });

  // 7. Follow-up reason excluded when requiresFollowUp === false
  it('excludes followUpReason when requiresFollowUp is false', () => {
    const visit = makeVisit({ fieldNotes: undefined });
    const items = [
      makeWorkItem({
        resultNotes: undefined,
        findings: undefined,
        requiresFollowUp: false,
        followUpReason: 'Should not appear',
      }),
    ];
    expect(extractLastVisitComment(visit, items)).toBeNull();
  });

  // 8. Multi-source join with newline in deterministic order
  it('joins multiple note sources with newline in deterministic order', () => {
    const visit = makeVisit({ fieldNotes: 'Hlavní poznámka' });
    const items = [
      makeWorkItem({ id: 'wi-1', resultNotes: 'Práce hotova', findings: 'Drobná závada' }),
      makeWorkItem({
        id: 'wi-2',
        resultNotes: undefined,
        findings: undefined,
        requiresFollowUp: true,
        followUpReason: 'Objednat díl',
      }),
    ];
    expect(extractLastVisitComment(visit, items)).toBe(
      'Hlavní poznámka\nPráce hotova\nDrobná závada\n⚠ Objednat díl',
    );
  });

  // 9. Empty workItems array -> visit-level fieldNotes only
  it('returns visit fieldNotes when workItems is empty array', () => {
    const visit = makeVisit({ fieldNotes: 'Vše v pořádku' });
    expect(extractLastVisitComment(visit, [])).toBe('Vše v pořádku');
  });

  // 10. Deterministic precedence per work item
  it('collects notes in order: wi.resultNotes > wi.findings > wi.followUpReason per item', () => {
    const visit = makeVisit({ fieldNotes: undefined });
    const items = [
      makeWorkItem({
        resultNotes: 'Note A',
        findings: 'Finding A',
        requiresFollowUp: true,
        followUpReason: 'Follow A',
      }),
    ];
    expect(extractLastVisitComment(visit, items)).toBe('Note A\nFinding A\n⚠ Follow A');
  });

  // 11. Multiline text preserved
  it('preserves multiline text within a single note field', () => {
    const visit = makeVisit({ fieldNotes: 'Řádek 1\nŘádek 2\nŘádek 3' });
    expect(extractLastVisitComment(visit, [])).toBe('Řádek 1\nŘádek 2\nŘádek 3');
  });

  // 12. Very long note passed through (no truncation in pure layer)
  it('passes through very long notes without truncation', () => {
    const longNote = 'A'.repeat(5000);
    const visit = makeVisit({ fieldNotes: longNote });
    expect(extractLastVisitComment(visit, [])).toBe(longNote);
  });

  // 13. Unicode/diacritics preserved
  it('preserves Czech diacritics and unicode', () => {
    const visit = makeVisit({ fieldNotes: 'Příliš žluťoučký kůň úpěl ďábelské ódy' });
    expect(extractLastVisitComment(visit, [])).toBe('Příliš žluťoučký kůň úpěl ďábelské ódy');
  });

  // 14. Pure function accepts single Visit + workItems (no multi-visit logic)
  it('accepts a single visit and workItems, not an array of visits', () => {
    const visit = makeVisit({ fieldNotes: 'Single visit note' });
    const result = extractLastVisitComment(visit, []);
    expect(result).toBe('Single visit note');
  });

  // E1: reads fieldNotes instead of resultNotes
  it('E1: reads fieldNotes property on Visit', () => {
    const visit = makeVisit({ fieldNotes: 'Field note content' });
    expect(extractLastVisitComment(visit, [])).toBe('Field note content');
  });

  // E2: strips markdown from fieldNotes
  it('E2: strips markdown formatting from fieldNotes', () => {
    const visit = makeVisit({ fieldNotes: '**bold** text and *italic*' });
    const result = extractLastVisitComment(visit, []);
    expect(result).toBe('bold text and italic');
  });

  // E3: does not strip work-item resultNotes (plain text)
  it('E3: does not alter work-item resultNotes (already plain text)', () => {
    const visit = makeVisit({ fieldNotes: undefined });
    const items = [makeWorkItem({ resultNotes: 'Plain work item note' })];
    expect(extractLastVisitComment(visit, items)).toBe('Plain work item note');
  });

  // E4: handles mixed markdown fieldNotes + plain work-item notes
  it('E4: handles mixed markdown fieldNotes and plain work-item notes in correct order', () => {
    const visit = makeVisit({ fieldNotes: '**hlavní** poznámka' });
    const items = [makeWorkItem({ resultNotes: 'plain item note' })];
    const result = extractLastVisitComment(visit, items);
    expect(result).toBe('hlavní poznámka\nplain item note');
  });
});
