/**
 * Phase 4 GREEN tests: visitService field notes functions — SV1–SV5.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));

import { saveFieldNotes, fetchNotesHistory, completeVisit } from '../visitService';
import type { VisitServiceDeps } from '../visitService';

function makeDeps(mockFn?: ReturnType<typeof vi.fn>): VisitServiceDeps {
  return { request: mockFn ?? vi.fn().mockResolvedValue({ payload: {} }) };
}

describe('saveFieldNotes (SV1, SV2)', () => {
  it('SV1: publishes to sazinka.visit.update_field_notes', async () => {
    const request = vi.fn().mockResolvedValue({ payload: { id: 'v-1' } });
    const deps = makeDeps(request);
    await saveFieldNotes({ visitId: 'v-1', sessionId: 'sess-1', fieldNotes: 'notes' }, deps);
    expect(request).toHaveBeenCalledWith(
      'sazinka.visit.update_field_notes',
      expect.anything(),
    );
  });

  it('SV2: sends visitId, sessionId, and fieldNotes in payload', async () => {
    const request = vi.fn().mockResolvedValue({ payload: { id: 'v-1' } });
    const deps = makeDeps(request);
    await saveFieldNotes({ visitId: 'v-1', sessionId: 'sess-1', fieldNotes: 'hello notes' }, deps);
    const sentPayload = request.mock.calls[0][1];
    expect(sentPayload.payload).toMatchObject({
      visitId: 'v-1',
      sessionId: 'sess-1',
      fieldNotes: 'hello notes',
    });
  });
});

describe('fetchNotesHistory (SV3)', () => {
  it('SV3: publishes to sazinka.visit.notes.history', async () => {
    const request = vi.fn().mockResolvedValue({ payload: { entries: [] } });
    const deps = makeDeps(request);
    await fetchNotesHistory('v-1', deps);
    expect(request).toHaveBeenCalledWith(
      'sazinka.visit.notes.history',
      expect.anything(),
    );
  });

  it('SV3b: sends visitId in payload', async () => {
    const request = vi.fn().mockResolvedValue({ payload: { entries: [] } });
    const deps = makeDeps(request);
    await fetchNotesHistory('v-123', deps);
    const sentPayload = request.mock.calls[0][1];
    expect(sentPayload.payload).toMatchObject({ visitId: 'v-123' });
  });
});

describe('completeVisit fieldNotes forwarding (SV4, SV5)', () => {
  it('SV4: includes fieldNotes and sessionId when provided', async () => {
    const request = vi.fn().mockResolvedValue({ payload: { id: 'v-1' } });
    const deps = makeDeps(request);
    await completeVisit(
      { id: 'v-1', result: 'successful', fieldNotes: 'final notes', sessionId: 'sess-1' },
      deps,
    );
    const sentPayload = request.mock.calls[0][1];
    expect(sentPayload.payload.fieldNotes).toBe('final notes');
    expect(sentPayload.payload.sessionId).toBe('sess-1');
  });

  it('SV5: does not include fieldNotes key when not provided', async () => {
    const request = vi.fn().mockResolvedValue({ payload: { id: 'v-1' } });
    const deps = makeDeps(request);
    await completeVisit({ id: 'v-1', result: 'failed' }, deps);
    const sentPayload = request.mock.calls[0][1];
    expect(sentPayload.payload.fieldNotes).toBeUndefined();
    expect(sentPayload.payload.sessionId).toBeUndefined();
  });
});
