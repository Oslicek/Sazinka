import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Calendar } from './Calendar';
import type { CalendarItem } from '@shared/calendar';
import { mockMatchMedia, setViewport, VIEWPORTS } from '../test/utils/responsive';

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(),
}));

// Mock dependencies
vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearch: vi.fn(() => ({})),
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector) =>
    selector({
      isConnected: true,
      error: null,
      request: vi.fn(),
    })
  ),
}));

vi.mock('../services/calendarService', () => ({
  listCalendarItems: vi.fn(),
}));

vi.mock('../services/crewService', () => ({
  listCrews: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../components/calendar', () => ({
  CalendarGrid: ({ items }: { items: CalendarItem[] }) => (
    <div data-testid="calendar-grid">{items.length} items</div>
  ),
}));

vi.mock('../components/calendar/DayCell', () => ({
  DayCell: ({ day, items }: any) => (
    <div data-testid="day-cell">
      {day.dateKey}: {items.length}
    </div>
  ),
}));

import { listCalendarItems } from '../services/calendarService';
import { useBreakpoint } from '@/hooks/useBreakpoint';
const mockUseBreakpoint = vi.mocked(useBreakpoint);

describe('Calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: desktop
    mockMatchMedia(VIEWPORTS.desktop.width);
    setViewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
  });

  it('should render calendar header', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('should load calendar items on mount', async () => {
    const mockItems: CalendarItem[] = [
      {
        id: '1',
        type: 'revision',
        date: '2026-01-15',
        status: 'scheduled',
        title: 'Test Customer',
      },
    ];
    
    vi.mocked(listCalendarItems).mockResolvedValue({ items: mockItems });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(listCalendarItems).toHaveBeenCalled();
    });
  });

  it('should display month stats', async () => {
    const mockItems: CalendarItem[] = [
      { id: '1', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'A' },
      { id: '2', type: 'visit', date: '2026-01-16', status: 'overdue', title: 'B' },
      { id: '3', type: 'task', date: '2026-01-17', status: 'completed', title: 'C' },
      { id: '4', type: 'task', date: '2026-01-18', status: 'pending', title: 'D' },
    ];
    
    vi.mocked(listCalendarItems).mockResolvedValue({ items: mockItems });
    
    render(<Calendar />);
    
    await waitFor(() => {
      // Each stat is 1: scheduled, overdue, completed, pending
      const ones = screen.getAllByText('1');
      expect(ones.length).toBe(4);
    });
  });

  it('should show error when connection fails', async () => {
    vi.mocked(listCalendarItems).mockRejectedValue(new Error('Connection failed'));
    
    render(<Calendar />);
    
    await waitFor(() => {
      // Calendar sets error from err.message when fetch fails, or fallback i18n key
      expect(screen.getByText(/Connection failed|error_load_failed/)).toBeInTheDocument();
    });
  });

  it('should render view mode toggle buttons', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText('view_due')).toBeInTheDocument();
      expect(screen.getByText('view_scheduled')).toBeInTheDocument();
    });
  });

  it('should render layout mode toggle buttons', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText('layout_month')).toBeInTheDocument();
      expect(screen.getByText('layout_week')).toBeInTheDocument();
      expect(screen.getByText('layout_day')).toBeInTheDocument();
      expect(screen.getByText('layout_agenda')).toBeInTheDocument();
    });
  });

  it('should render filter controls', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText('filter_types')).toBeInTheDocument();
      expect(screen.getByText('filter_status')).toBeInTheDocument();
      expect(screen.getByText('filter_crew')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('filter_customer_placeholder')).toBeInTheDocument();
    });
  });
});

// ── Phase 6: mobile responsive tests ─────────────────────────────────────────

describe('Calendar — Phase 6 mobile', () => {
  beforeEach(() => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
  });

  it('defaults to day layout on phone (isMobileUi=true)', () => {
    mockMatchMedia(VIEWPORTS.phone.width);
    setViewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'phone',
      isPhone: true,
      isMobileUi: true,
      isTouch: true,
    });
    render(<Calendar />);
    // The day layout button should be active (has active class or aria-pressed)
    const dayBtn = screen.getByText('layout_day');
    expect(dayBtn.closest('button')).toHaveClass(/_active_/);
  });

  it('defaults to day layout on tablet (isMobileUi=true)', () => {
    mockMatchMedia(VIEWPORTS.tablet.width);
    setViewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'tablet',
      isPhone: false,
      isMobileUi: true,
      isTouch: true,
    });
    render(<Calendar />);
    const dayBtn = screen.getByText('layout_day');
    expect(dayBtn.closest('button')).toHaveClass(/_active_/);
  });

  it('defaults to week layout on desktop', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    render(<Calendar />);
    const weekBtn = screen.getByText('layout_week');
    expect(weekBtn.closest('button')).toHaveClass(/_active_/);
  });

  it('does not override layout when URL already specifies one on mobile', async () => {
    // Simulate URL with layout=week on mobile — user explicitly chose it, keep it
    const router = await import('@tanstack/react-router');
    vi.mocked(router.useSearch).mockReturnValue({ layout: 'week' } as never);
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'phone',
      isPhone: true,
      isMobileUi: true,
      isTouch: true,
    });
    render(<Calendar />);
    const weekBtn = screen.getByText('layout_week');
    expect(weekBtn.closest('button')).toHaveClass(/_active_/);
  });
});
