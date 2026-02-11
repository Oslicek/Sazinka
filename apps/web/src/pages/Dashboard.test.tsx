import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import type { CalendarItem } from '@shared/calendar';
import type { RevisionStats } from '../services/revisionService';

// Mock dependencies
vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
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

vi.mock('../services/revisionService', () => ({
  getRevisionStats: vi.fn(),
}));

vi.mock('../services/calendarService', () => ({
  listCalendarItems: vi.fn(),
}));

import { getRevisionStats } from '../services/revisionService';
import { listCalendarItems } from '../services/calendarService';

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dashboard title', async () => {
    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 0,
      dueThisWeek: 0,
      scheduledToday: 0,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });

    render(<Dashboard />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('should load and display revision stats', async () => {
    const mockStats: RevisionStats = {
      overdue: 5,
      dueThisWeek: 12,
      scheduledToday: 3,
      completedThisMonth: 45,
    };

    vi.mocked(getRevisionStats).mockResolvedValue(mockStats);
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument(); // overdue
      expect(screen.getByText('12')).toBeInTheDocument(); // due this week
      expect(screen.getByText('3')).toBeInTheDocument(); // scheduled today
      expect(screen.getByText('45')).toBeInTheDocument(); // completed this month
    });
  });

  it('should show call queue banner when items to call exist', async () => {
    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 3,
      dueThisWeek: 7,
      scheduledToday: 0,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('10 zákazníků k obvolání')).toBeInTheDocument();
    });
  });

  it('should not show call queue banner when no items to call', async () => {
    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 0,
      dueThisWeek: 0,
      scheduledToday: 0,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.queryByText(/zákazníků k obvolání/)).not.toBeInTheDocument();
    });
  });

  it('should display today items worklist', async () => {
    const mockTodayItems: CalendarItem[] = [
      {
        id: '1',
        type: 'revision',
        date: '2026-01-25',
        status: 'scheduled',
        title: 'Customer A',
        customerName: 'Customer A',
        timeStart: '09:00',
      },
      {
        id: '2',
        type: 'visit',
        date: '2026-01-25',
        status: 'scheduled',
        title: 'Customer B',
        customerName: 'Customer B',
        timeStart: '14:00',
      },
    ];

    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 0,
      dueThisWeek: 0,
      scheduledToday: 2,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: mockTodayItems });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Dnešní plán')).toBeInTheDocument();
      expect(screen.getByText('Customer A')).toBeInTheDocument();
      expect(screen.getByText('Customer B')).toBeInTheDocument();
    });
  });

  it('should calculate completion rate correctly', async () => {
    // 4 planned (scheduled+in_progress), 2 completed = 50%
    const mockWeekItems: CalendarItem[] = [
      { id: '1', type: 'revision', date: '2026-01-25', status: 'scheduled', title: 'A' },
      { id: '2', type: 'revision', date: '2026-01-26', status: 'scheduled', title: 'B' },
      { id: '3', type: 'revision', date: '2026-01-27', status: 'scheduled', title: 'C' },
      { id: '4', type: 'revision', date: '2026-01-28', status: 'scheduled', title: 'D' },
      { id: '5', type: 'revision', date: '2026-01-29', status: 'completed', title: 'E' },
      { id: '6', type: 'revision', date: '2026-01-30', status: 'completed', title: 'F' },
    ];

    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 0,
      dueThisWeek: 0,
      scheduledToday: 0,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: mockWeekItems });

    render(<Dashboard />);

    await waitFor(() => {
      // 2 completed out of 4 planned = 50%
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  it('should show risk indicators for overdue and unassigned items', async () => {
    const mockWeekItems: CalendarItem[] = [
      { id: '1', type: 'revision', date: '2026-01-25', status: 'overdue', title: 'A', crewId: null },
      { id: '2', type: 'visit', date: '2026-01-26', status: 'scheduled', title: 'B', crewId: null },
      { id: '3', type: 'task', date: '2026-01-27', status: 'pending', title: 'C' },
    ];

    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 1,
      dueThisWeek: 0,
      scheduledToday: 0,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: mockWeekItems });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rizika v příštích 7 dnech')).toBeInTheDocument();
      // "1 položek" appears for overdue and follow-ups; "2 položek" for unassigned
      const onePolozek = screen.getAllByText('1 položek');
      const twoPolozek = screen.getAllByText('2 položek');
      expect(onePolozek.length).toBeGreaterThanOrEqual(2); // overdue + follow-ups
      expect(twoPolozek.length).toBeGreaterThanOrEqual(1); // unassigned
    });
  });

  it('should render quick action buttons', async () => {
    vi.mocked(getRevisionStats).mockResolvedValue({
      overdue: 0,
      dueThisWeek: 0,
      scheduledToday: 0,
      completedThisMonth: 0,
    });
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Začít obvolávat/)).toBeInTheDocument();
      expect(screen.getByText(/Můj den/)).toBeInTheDocument();
      expect(screen.getByText(/Naplánovat/)).toBeInTheDocument();
      expect(screen.getByText(/Nový zákazník/)).toBeInTheDocument();
    });
  });
});
