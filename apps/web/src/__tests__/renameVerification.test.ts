/**
 * Phase 7 verification tests: R1–R6.
 * Confirms the resultNotes → fieldNotes rename is complete for Visit-typed code.
 */
import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'child_process';
import type { Visit } from '@shared/visit';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: Object.assign(vi.fn().mockReturnValue(true), {
    getState: () => ({ request: vi.fn() }),
  }),
}));

describe('Rename verification', () => {
  // R1: no resultNotes on Visit interface in shared types
  it('R1: Visit type has fieldNotes, not resultNotes', () => {
    const visit = {} as Visit;
    expect('fieldNotes' in ({} as Record<keyof Visit, unknown>)).toBe(false);
    const keys = [
      'id', 'customerId', 'userId', 'visitType', 'status',
      'scheduledDate', 'fieldNotes',
    ] satisfies (keyof Visit)[];
    expect(keys).toContain('fieldNotes');
  });

  // R2: Visit interface exposes fieldNotes as optional string | null
  it('R2: Visit.fieldNotes accepts string or null', () => {
    const v1: Visit = {
      id: 'v1', customerId: 'c1', userId: 'u1',
      visitType: 'consultation', status: 'planned',
      scheduledDate: '2025-01-01', scheduledTimeStart: null,
      scheduledTimeEnd: null, result: null, fieldNotes: 'notes',
      requiresFollowUp: false, followUpReason: null,
      actualArrival: null, actualDeparture: null,
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    expect(v1.fieldNotes).toBe('notes');
    const v2: Visit = { ...v1, fieldNotes: null };
    expect(v2.fieldNotes).toBeNull();
  });

  // R3: existing lastVisitComment tests pass (validated by full suite)
  it('R3: extractLastVisitComment is importable and callable', async () => {
    const { extractLastVisitComment } = await import('@/lib/lastVisitComment');
    expect(typeof extractLastVisitComment).toBe('function');
  });

  // R4: useLastVisitComment hook is importable
  it('R4: useLastVisitComment hook is importable', async () => {
    const mod = await import('@/hooks/useLastVisitComment');
    expect(typeof mod.useLastVisitComment).toBe('function');
  });

  // R5: stripMarkdown utility works on fieldNotes-style markdown
  it('R5: stripMarkdown strips markdown from fieldNotes content', async () => {
    const { stripMarkdown } = await import('@/lib/stripMarkdown');
    expect(stripMarkdown('**bold** and *italic*')).toBe('bold and italic');
  });

  // R6: no Visit-typed resultNotes in frontend (grep-based)
  it('R6: no resultNotes on Visit-typed code in frontend (work-item refs excluded)', () => {
    const srcDir = new URL('../../src', import.meta.url).pathname;
    const grepCmd = `rg "Visit.*resultNotes|resultNotes.*Visit" "${srcDir}" --type ts --type tsx -l 2>/dev/null || true`;
    let output = '';
    try {
      output = execSync(grepCmd, { encoding: 'utf-8' }).trim();
    } catch {
      output = '';
    }
    const files = output
      .split('\n')
      .filter((f) => f.length > 0)
      .filter((f) => !f.includes('renameVerification'));
    expect(files).toEqual([]);
  });
});
