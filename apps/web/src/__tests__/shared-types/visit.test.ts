/**
 * Phase 1 RED tests: Verify Visit shared-type contract after fieldNotes rename.
 * Tests T1–T6 from the TDD plan.
 */
import { describe, it, expect } from 'vitest';
import type {
  Visit,
  CompleteVisitRequest,
  UpdateFieldNotesRequest,
  ListNotesHistoryRequest,
  ListNotesHistoryResponse,
  NotesHistoryEntry,
} from '@shared/visit';

const BASE_VISIT: Visit = {
  id: 'v-1',
  userId: 'u-1',
  customerId: 'c-1',
  scheduledDate: '2026-01-01',
  status: 'planned',
  visitType: 'revision',
  requiresFollowUp: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('Visit.fieldNotes (T1)', () => {
  it('accepts a string value', () => {
    const v: Visit = { ...BASE_VISIT, fieldNotes: 'some **notes**' };
    expect(v.fieldNotes).toBe('some **notes**');
  });

  it('accepts null', () => {
    const v: Visit = { ...BASE_VISIT, fieldNotes: null };
    expect(v.fieldNotes).toBeNull();
  });

  it('is omittable (undefined)', () => {
    const v: Visit = { ...BASE_VISIT };
    expect(v.fieldNotes).toBeUndefined();
  });
});

describe('Visit has no resultNotes (T2)', () => {
  it('does NOT have resultNotes property at runtime', () => {
    const v: Visit = { ...BASE_VISIT };
    expect('resultNotes' in v).toBe(false);
  });
});

describe('CompleteVisitRequest.fieldNotes / sessionId (T3)', () => {
  it('accepts fieldNotes and sessionId as optional', () => {
    const req: CompleteVisitRequest = {
      id: 'v-1',
      result: 'successful',
      fieldNotes: '**markdown**',
      sessionId: 'sess-uuid',
    };
    expect(req.fieldNotes).toBe('**markdown**');
    expect(req.sessionId).toBe('sess-uuid');
  });

  it('works without fieldNotes and sessionId', () => {
    const req: CompleteVisitRequest = { id: 'v-1', result: 'failed' };
    expect(req.fieldNotes).toBeUndefined();
    expect(req.sessionId).toBeUndefined();
  });
});

describe('UpdateFieldNotesRequest shape (T4)', () => {
  it('requires visitId, sessionId, and fieldNotes', () => {
    const req: UpdateFieldNotesRequest = {
      visitId: 'v-1',
      sessionId: 'sess-uuid',
      fieldNotes: '# Heading\n\nContent',
    };
    expect(req.visitId).toBe('v-1');
    expect(req.sessionId).toBe('sess-uuid');
    expect(req.fieldNotes).toBe('# Heading\n\nContent');
  });
});

describe('ListNotesHistoryResponse shape (T5)', () => {
  it('contains entries array of NotesHistoryEntry', () => {
    const entry: NotesHistoryEntry = {
      id: 'e-1',
      sessionId: 'sess-1',
      editedByUserId: 'u-1',
      editedByName: 'Jan Novák',
      fieldNotes: 'note content',
      firstEditedAt: '2026-01-01T10:00:00Z',
      lastEditedAt: '2026-01-01T11:00:00Z',
      changeCount: 3,
    };
    const resp: ListNotesHistoryResponse = { entries: [entry] };
    expect(resp.entries).toHaveLength(1);
    expect(resp.entries[0].changeCount).toBe(3);
  });

  it('accepts empty entries array', () => {
    const resp: ListNotesHistoryResponse = { entries: [] };
    expect(resp.entries).toHaveLength(0);
  });
});

describe('ListNotesHistoryRequest shape (T6)', () => {
  it('requires visitId', () => {
    const req: ListNotesHistoryRequest = { visitId: 'v-1' };
    expect(req.visitId).toBe('v-1');
  });
});
