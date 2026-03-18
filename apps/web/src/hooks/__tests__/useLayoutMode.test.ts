import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayoutMode } from '../useLayoutMode';

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(),
}));

vi.mock('@/services/layoutPreferenceService', () => ({
  getLocalLayoutPreference: vi.fn(),
  setLocalLayoutPreference: vi.fn(),
  syncLayoutPreferenceToDb: vi.fn(),
}));

import { useBreakpoint } from '@/hooks/useBreakpoint';
import {
  getLocalLayoutPreference,
  setLocalLayoutPreference,
  syncLayoutPreferenceToDb,
} from '@/services/layoutPreferenceService';

const mockUseBreakpoint = vi.mocked(useBreakpoint);
const mockGetLocal = vi.mocked(getLocalLayoutPreference);
const mockSetLocal = vi.mocked(setLocalLayoutPreference);
const mockSyncDb = vi.mocked(syncLayoutPreferenceToDb);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockGetLocal.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLayoutMode', () => {
  it('returns stack default on phone', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'phone',
      isPhone: true,
      isMobileUi: true,
      isTouch: true,
    });
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('stack');
  });

  it('returns dual default on tablet', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'tablet',
      isPhone: false,
      isMobileUi: true,
      isTouch: true,
    });
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('dual');
  });

  it('returns wide default on desktop', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('wide');
  });

  it('returns persisted mode from localStorage if available', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    mockGetLocal.mockReturnValue({ mode: 'grid', updatedAt: 1000 });
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('grid');
  });

  it('calls setLocalLayoutPreference when mode changes', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    const { result } = renderHook(() => useLayoutMode());

    act(() => {
      result.current.setMode('grid');
    });

    expect(mockSetLocal).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'grid' })
    );
  });

  it('debounces DB sync when mode changes', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    const { result } = renderHook(() => useLayoutMode());

    act(() => {
      result.current.setMode('dual');
    });

    expect(mockSyncDb).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mockSyncDb).toHaveBeenCalledTimes(1);
  });
});
