import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNoteDraft } from './useNoteDraft';

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('useNoteDraft', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  // NB4 — localStorage key includes entity type and id
  it('NB4: storage key includes entity type and id', () => {
    const setItem = vi.spyOn(localStorageMock, 'setItem');
    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'device',
        entityId: 'device-001',
        sessionId: 'session-abc',
        serverContent: '',
      }),
    );

    act(() => {
      result.current.updateDraft('new content');
    });

    expect(setItem).toHaveBeenCalledWith(
      'noteDraft:device:device-001:session-abc',
      'new content',
    );
  });

  it('different entity types produce different storage keys', () => {
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem');

    const { result: visitResult } = renderHook(() =>
      useNoteDraft({ entityType: 'visit', entityId: 'id-1', sessionId: 'sess', serverContent: '' }),
    );
    const { result: deviceResult } = renderHook(() =>
      useNoteDraft({ entityType: 'device', entityId: 'id-1', sessionId: 'sess', serverContent: '' }),
    );

    act(() => { visitResult.current.updateDraft('visit content'); });
    act(() => { deviceResult.current.updateDraft('device content'); });

    const keys = setItemSpy.mock.calls.map(([k]) => k);
    expect(keys).toContain('noteDraft:visit:id-1:sess');
    expect(keys).toContain('noteDraft:device:id-1:sess');
  });

  // NB5 — conflict detection same as visit draft behavior
  it('NB5: detects conflict when local draft differs from server content', () => {
    localStorageMock.setItem('noteDraft:visit:entity-1:sess-1', 'local draft');

    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'visit',
        entityId: 'entity-1',
        sessionId: 'sess-1',
        serverContent: 'server content',
      }),
    );

    expect(result.current.hasConflict).toBe(true);
    expect(result.current.draft).toBe('local draft');
  });

  it('no conflict when local draft matches server content', () => {
    localStorageMock.setItem('noteDraft:visit:entity-1:sess-1', 'same content');

    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'visit',
        entityId: 'entity-1',
        sessionId: 'sess-1',
        serverContent: 'same content',
      }),
    );

    expect(result.current.hasConflict).toBe(false);
  });

  it('no conflict when no local draft exists', () => {
    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'customer',
        entityId: 'cust-1',
        sessionId: 'sess-1',
        serverContent: 'server content',
      }),
    );

    expect(result.current.hasConflict).toBe(false);
  });

  it('resolveUseServer replaces draft with server content', () => {
    localStorageMock.setItem('noteDraft:visit:entity-1:sess-1', 'local draft');

    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'visit',
        entityId: 'entity-1',
        sessionId: 'sess-1',
        serverContent: 'server content',
      }),
    );

    act(() => {
      result.current.resolveUseServer();
    });

    expect(result.current.draft).toBe('server content');
    expect(result.current.hasConflict).toBe(false);
  });

  it('resolveKeepLocal saves local draft and clears conflict', async () => {
    localStorageMock.setItem('noteDraft:customer:cust-1:sess-1', 'my local draft');
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'customer',
        entityId: 'cust-1',
        sessionId: 'sess-1',
        serverContent: 'server version',
        onSave,
      }),
    );

    await act(async () => {
      await result.current.resolveKeepLocal();
    });

    expect(onSave).toHaveBeenCalledWith('my local draft');
    expect(result.current.hasConflict).toBe(false);
  });

  it('flushDraft calls onSave and removes draft from localStorage', async () => {
    localStorageMock.setItem('noteDraft:device:dev-1:sess-1', 'draft to flush');
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'device',
        entityId: 'dev-1',
        sessionId: 'sess-1',
        serverContent: '',
        onSave,
      }),
    );

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.flushDraft();
    });

    expect(onSave).toHaveBeenCalledWith('draft to flush');
    expect(success).toBe(true);
    expect(localStorageMock.getItem('noteDraft:device:dev-1:sess-1')).toBeNull();
  });

  it('flushDraft returns false when onSave throws', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'));

    const { result } = renderHook(() =>
      useNoteDraft({
        entityType: 'visit',
        entityId: 'v-1',
        sessionId: 'sess-1',
        serverContent: '',
        onSave,
      }),
    );

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.flushDraft();
    });

    expect(success).toBe(false);
  });
});
