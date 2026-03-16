import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelWindow } from '../usePanelWindow';

describe('usePanelWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('isDetached is false initially', () => {
    const { result } = renderHook(() => usePanelWindow('sazinka-inbox-map'));
    expect(result.current.isDetached).toBe(false);
  });

  it('isDetached becomes true after detach()', () => {
    const mockWin = { closed: false } as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockWin);

    const { result } = renderHook(() => usePanelWindow('sazinka-inbox-map'));

    act(() => {
      result.current.detach('/inbox/map');
    });

    expect(result.current.isDetached).toBe(true);
  });

  it('calls window.open with correct arguments', () => {
    const mockWin = { closed: false } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWin);

    const { result } = renderHook(() => usePanelWindow('sazinka-inbox-map'));

    act(() => {
      result.current.detach('/inbox/map', 'width=800,height=600');
    });

    expect(openSpy).toHaveBeenCalledWith('/inbox/map', 'sazinka-inbox-map', 'width=800,height=600');
  });

  it('isDetached becomes false after reattach()', () => {
    const mockWin = { closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockWin);

    const { result } = renderHook(() => usePanelWindow('sazinka-inbox-map'));

    act(() => {
      result.current.detach('/inbox/map');
    });
    act(() => {
      result.current.reattach();
    });

    expect(result.current.isDetached).toBe(false);
    expect(mockWin.close).toHaveBeenCalled();
  });

  it('auto-reattaches when detached window is closed externally', () => {
    const mockWin = { closed: false } as { closed: boolean };
    vi.spyOn(window, 'open').mockReturnValue(mockWin as Window);

    const { result } = renderHook(() => usePanelWindow('sazinka-inbox-map'));

    act(() => {
      result.current.detach('/inbox/map');
    });

    expect(result.current.isDetached).toBe(true);

    mockWin.closed = true;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.isDetached).toBe(false);
  });

  it('cleans up poll interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const mockWin = { closed: false } as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockWin);

    const { result, unmount } = renderHook(() => usePanelWindow('sazinka-inbox-map'));

    act(() => {
      result.current.detach('/inbox/map');
    });

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
