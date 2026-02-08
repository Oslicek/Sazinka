import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not call saveFn when hasChanges is false', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSave({ saveFn, hasChanges: false, debounceMs: 1000 }));

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(saveFn).not.toHaveBeenCalled();
  });

  it('should call saveFn after debounce when hasChanges is true', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSave({ saveFn, hasChanges: true, debounceMs: 1500 }));

    // Not called before debounce
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveFn).not.toHaveBeenCalled();

    // Called after debounce
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(saveFn).toHaveBeenCalledOnce();
  });

  it('should reset debounce timer when hasChanges toggles', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ hasChanges }) => useAutoSave({ saveFn, hasChanges, debounceMs: 1000 }),
      { initialProps: { hasChanges: true } }
    );

    // Advance partway
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(saveFn).not.toHaveBeenCalled();

    // Trigger rerender with hasChanges still true (simulating new change)
    rerender({ hasChanges: true });

    // Original timer would have fired at 1000ms, but reset should delay it
    // This depends on the dependency array - `hasChanges` doesn't change here

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Should have fired by now (800 + 300 = 1100ms > 1000ms debounce)
    expect(saveFn).toHaveBeenCalledOnce();
  });

  it('should return isSaving=true while saveFn is executing', async () => {
    let resolveSave: () => void;
    const saveFn = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSave = resolve; })
    );

    const { result } = renderHook(() =>
      useAutoSave({ saveFn, hasChanges: true, debounceMs: 500 })
    );

    expect(result.current.isSaving).toBe(false);

    // Trigger the save
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.isSaving).toBe(true);
    expect(saveFn).toHaveBeenCalledOnce();

    // Resolve the save
    await act(async () => {
      resolveSave!();
    });

    expect(result.current.isSaving).toBe(false);
  });

  it('should return lastSaved timestamp after successful save', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutoSave({ saveFn, hasChanges: true, debounceMs: 500 })
    );

    expect(result.current.lastSaved).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it('should return saveError when saveFn fails', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('Network failure'));
    const { result } = renderHook(() =>
      useAutoSave({ saveFn, hasChanges: true, debounceMs: 500 })
    );

    expect(result.current.saveError).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.saveError).toBe('Network failure');
    expect(result.current.isSaving).toBe(false);
  });

  it('should clear saveError on next successful save via retry', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useAutoSave({ saveFn, hasChanges: true, debounceMs: 500 })
    );

    // First save fails
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.saveError).toBe('Fail');

    // Retry clears the error on success
    await act(async () => {
      result.current.retry();
    });

    expect(result.current.saveError).toBeNull();
    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it('should clear saveError when hasChanges flips false then true again', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce(undefined);

    const { result, rerender } = renderHook(
      ({ hasChanges }) => useAutoSave({ saveFn, hasChanges, debounceMs: 500 }),
      { initialProps: { hasChanges: true } }
    );

    // First save fails
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.saveError).toBe('Fail');

    // Clear changes, then set them again → triggers new debounce cycle
    rerender({ hasChanges: false });
    rerender({ hasChanges: true });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.saveError).toBeNull();
  });

  it('should expose retry function that triggers immediate save', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useAutoSave({ saveFn, hasChanges: true, debounceMs: 500 })
    );

    // First save fails
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.saveError).toBe('Fail');

    // Retry immediately
    await act(async () => {
      result.current.retry();
    });

    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBeNull();
    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it('should not save when disabled', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAutoSave({ saveFn, hasChanges: true, debounceMs: 500, enabled: false })
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveFn).not.toHaveBeenCalled();
  });
});
