import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from './useBodyScrollLock';

describe('useBodyScrollLock', () => {
  beforeEach(() => {
    // Reset body styles before each test
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';

    // Mock window.scrollY and window.scrollTo
    Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: 0 });
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    vi.restoreAllMocks();
  });

  it('locks body scroll when true', () => {
    renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.width).toBe('100%');
  });

  it('does not lock body scroll when false', () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });

  it('sets top to negative scrollY when locking', () => {
    Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: 200 });
    renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.top).toBe('-200px');
  });

  it('unlocks body scroll when changed from true to false', () => {
    const { rerender } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: true },
    });
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ locked: false });
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(document.body.style.width).toBe('');
    expect(document.body.style.top).toBe('');
  });

  it('restores scroll position on unlock', () => {
    Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: 350 });
    const { rerender } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: true },
    });

    rerender({ locked: false });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 350);
  });

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });
});
