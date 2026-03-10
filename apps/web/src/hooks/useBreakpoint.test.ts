import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint, BP_PHONE_MAX, BP_TABLET_MAX } from './useBreakpoint';
import { mockMatchMedia, setViewport } from '../test/utils/responsive';

describe('useBreakpoint', () => {
  beforeEach(() => {
    mockMatchMedia(1280);
    setViewport(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "desktop" for window width >= 1024', () => {
    mockMatchMedia(1280);
    setViewport(1280, 800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('desktop');
  });

  it('returns "tablet" for window width 640–1023', () => {
    mockMatchMedia(768);
    setViewport(768, 1024);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('tablet');
  });

  it('returns "phone" for window width <= 639', () => {
    mockMatchMedia(390);
    setViewport(390, 844);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('phone');
  });

  it('returns "phone" at exactly the phone boundary (639px)', () => {
    mockMatchMedia(BP_PHONE_MAX);
    setViewport(BP_PHONE_MAX, 800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('phone');
  });

  it('returns "tablet" at 640px (just above phone boundary)', () => {
    mockMatchMedia(BP_PHONE_MAX + 1);
    setViewport(BP_PHONE_MAX + 1, 800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('tablet');
  });

  it('returns "tablet" at exactly the tablet boundary (1023px)', () => {
    mockMatchMedia(BP_TABLET_MAX);
    setViewport(BP_TABLET_MAX, 800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('tablet');
  });

  it('returns "desktop" at 1024px (just above tablet boundary)', () => {
    mockMatchMedia(BP_TABLET_MAX + 1);
    setViewport(BP_TABLET_MAX + 1, 800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('desktop');
  });

  it('isPhone is true only for phone breakpoint', () => {
    mockMatchMedia(390);
    setViewport(390, 844);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.isPhone).toBe(true);

    mockMatchMedia(768);
    setViewport(768, 1024);
    const { result: r2 } = renderHook(() => useBreakpoint());
    expect(r2.current.isPhone).toBe(false);

    mockMatchMedia(1280);
    setViewport(1280, 800);
    const { result: r3 } = renderHook(() => useBreakpoint());
    expect(r3.current.isPhone).toBe(false);
  });

  it('isMobileUi is true for phone and tablet, false for desktop', () => {
    mockMatchMedia(390);
    setViewport(390, 844);
    const { result: phone } = renderHook(() => useBreakpoint());
    expect(phone.current.isMobileUi).toBe(true);

    mockMatchMedia(768);
    setViewport(768, 1024);
    const { result: tablet } = renderHook(() => useBreakpoint());
    expect(tablet.current.isMobileUi).toBe(true);

    mockMatchMedia(1280);
    setViewport(1280, 800);
    const { result: desktop } = renderHook(() => useBreakpoint());
    expect(desktop.current.isMobileUi).toBe(false);
  });

  it('isTouch mirrors isMobileUi', () => {
    mockMatchMedia(390);
    setViewport(390, 844);
    const { result: phone } = renderHook(() => useBreakpoint());
    expect(phone.current.isTouch).toBe(phone.current.isMobileUi);

    mockMatchMedia(1280);
    setViewport(1280, 800);
    const { result: desktop } = renderHook(() => useBreakpoint());
    expect(desktop.current.isTouch).toBe(desktop.current.isMobileUi);
  });

  it('updates when a matchMedia change event fires', () => {
    mockMatchMedia(1280);
    setViewport(1280, 800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBe('desktop');

    act(() => {
      mockMatchMedia(390);
      setViewport(390, 844);
    });

    // Re-render with new viewport
    const { result: result2 } = renderHook(() => useBreakpoint());
    expect(result2.current.breakpoint).toBe('phone');
  });

  it('cleans up event listeners on unmount', () => {
    const removeEventListenerSpy = vi.fn();
    const addEventListenerSpy = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
        dispatchEvent: vi.fn(),
      })),
    });

    const { unmount } = renderHook(() => useBreakpoint());
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2); // phone + tablet queries
  });
});
