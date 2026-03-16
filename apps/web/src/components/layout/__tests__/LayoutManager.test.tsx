import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayoutManager } from '../LayoutManager';

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

function phoneState() {
  return { breakpoint: 'phone' as const, isPhone: true, isMobileUi: true, isTouch: true };
}

function tabletState() {
  return { breakpoint: 'tablet' as const, isPhone: false, isMobileUi: true, isTouch: true };
}

function desktopState() {
  return { breakpoint: 'desktop' as const, isPhone: false, isMobileUi: false, isTouch: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockGetLocal.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LayoutManager', () => {
  it('renders nothing on phone breakpoint', () => {
    mockUseBreakpoint.mockReturnValue(phoneState());
    const { container } = render(
      <LayoutManager mode="stack" onModeChange={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders layout mode buttons on tablet', () => {
    mockUseBreakpoint.mockReturnValue(tabletState());
    render(<LayoutManager mode="split" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tiles/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /classic/i })).not.toBeInTheDocument();
  });

  it('renders layout mode buttons on desktop', () => {
    mockUseBreakpoint.mockReturnValue(desktopState());
    render(<LayoutManager mode="classic" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tiles/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /classic/i })).toBeInTheDocument();
  });

  it('highlights the active layout mode button', () => {
    mockUseBreakpoint.mockReturnValue(desktopState());
    render(<LayoutManager mode="tiles" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /tiles/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /split/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /classic/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onModeChange when a mode button is clicked', () => {
    mockUseBreakpoint.mockReturnValue(tabletState());
    const onModeChange = vi.fn();
    render(<LayoutManager mode="split" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole('button', { name: /tiles/i }));
    expect(onModeChange).toHaveBeenCalledWith('tiles');
  });

  it('persists mode to localStorage when changed', () => {
    mockUseBreakpoint.mockReturnValue(tabletState());
    render(<LayoutManager mode="split" onModeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /tiles/i }));
    expect(mockSetLocal).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'tiles' })
    );
  });

  it('restores mode from localStorage on mount', () => {
    mockUseBreakpoint.mockReturnValue(desktopState());
    mockGetLocal.mockReturnValue({ mode: 'tiles', updatedAt: 1000 });
    render(<LayoutManager mode="tiles" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /tiles/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('debounces DB sync (does not call syncToDb immediately on change)', () => {
    mockUseBreakpoint.mockReturnValue(tabletState());
    render(<LayoutManager mode="split" onModeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /tiles/i }));
    expect(mockSyncDb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(mockSyncDb).toHaveBeenCalledTimes(1);
  });
});
