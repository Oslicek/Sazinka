/**
 * Phase 5 tests: useFieldNotesDraft hook — D1–D8.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFieldNotesDraft } from '../useFieldNotesDraft';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

const VISIT_ID = 'visit-aaa';
const SESSION_ID = 'sess-111';
const STORAGE_KEY = `fieldNotes:${VISIT_ID}:${SESSION_ID}`;

function getStored(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

describe('useFieldNotesDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    localStorage.clear();
  });

  // D1: saves draft to localStorage
  it('D1: saves draft to localStorage after update', () => {
    const { result } = renderHook(() =>
      useFieldNotesDraft({ visitId: VISIT_ID, sessionId: SESSION_ID, serverContent: '' }),
    );
    act(() => result.current.updateDraft('Hello world'));
    expect(getStored()).toBe('Hello world');
  });

  // D2: restores draft on mount
  it('D2: restores draft from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'Saved draft');
    const { result } = renderHook(() =>
      useFieldNotesDraft({ visitId: VISIT_ID, sessionId: SESSION_ID, serverContent: '' }),
    );
    expect(result.current.draft).toBe('Saved draft');
  });

  // D3: clears draft after successful save
  it('D3: clears draft after successful flushDraft', async () => {
    localStorage.setItem(STORAGE_KEY, 'To be saved');
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFieldNotesDraft({
        visitId: VISIT_ID,
        sessionId: SESSION_ID,
        serverContent: '',
        onSave: mockSave,
      }),
    );
    const ok = await act(() => result.current.flushDraft());
    expect(ok).toBe(true);
    expect(getStored()).toBeNull();
    expect(mockSave).toHaveBeenCalledWith('To be saved');
  });

  // D4: detects conflict when local draft differs from server
  it('D4: detects conflict when local draft differs from server', () => {
    localStorage.setItem(STORAGE_KEY, 'Local version');
    const { result } = renderHook(() =>
      useFieldNotesDraft({
        visitId: VISIT_ID,
        sessionId: SESSION_ID,
        serverContent: 'Server version',
      }),
    );
    expect(result.current.hasConflict).toBe(true);
  });

  // D5: resolve keep local — server updated with local content
  it('D5: resolveKeepLocal sends local draft to save callback', async () => {
    localStorage.setItem(STORAGE_KEY, 'Local version');
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFieldNotesDraft({
        visitId: VISIT_ID,
        sessionId: SESSION_ID,
        serverContent: 'Server version',
        onSave: mockSave,
      }),
    );
    expect(result.current.hasConflict).toBe(true);
    await act(() => result.current.resolveKeepLocal());
    expect(mockSave).toHaveBeenCalledWith('Local version');
    expect(result.current.hasConflict).toBe(false);
  });

  // D6: resolve use server — local draft discarded
  it('D6: resolveUseServer discards local draft and uses server', () => {
    localStorage.setItem(STORAGE_KEY, 'Local version');
    const { result } = renderHook(() =>
      useFieldNotesDraft({
        visitId: VISIT_ID,
        sessionId: SESSION_ID,
        serverContent: 'Server version',
      }),
    );
    act(() => result.current.resolveUseServer());
    expect(result.current.draft).toBe('Server version');
    expect(getStored()).toBeNull();
    expect(result.current.hasConflict).toBe(false);
  });

  // D7: flushDraft triggers save and returns success
  it('D7: flushDraft triggers save and returns true on success', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFieldNotesDraft({
        visitId: VISIT_ID,
        sessionId: SESSION_ID,
        serverContent: '',
        onSave: mockSave,
      }),
    );
    act(() => result.current.updateDraft('Flush me'));
    const ok = await act(() => result.current.flushDraft());
    expect(ok).toBe(true);
    expect(mockSave).toHaveBeenCalledWith('Flush me');
  });

  // D8: flush failure does not clear draft
  it('D8: failed flushDraft preserves draft in localStorage', async () => {
    const mockSave = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() =>
      useFieldNotesDraft({
        visitId: VISIT_ID,
        sessionId: SESSION_ID,
        serverContent: '',
        onSave: mockSave,
      }),
    );
    act(() => result.current.updateDraft('Keep me'));
    const ok = await act(() => result.current.flushDraft());
    expect(ok).toBe(false);
    expect(getStored()).toBe('Keep me');
  });
});
