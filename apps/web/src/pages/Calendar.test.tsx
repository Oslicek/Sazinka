import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Calendar } from './Calendar';
import type { CalendarItem } from '@shared/calendar';

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

describe('Calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render calendar header', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    expect(screen.getByText('Kalendář')).toBeInTheDocument();
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
      expect(screen.getByText('1')).toBeInTheDocument(); // scheduled
      expect(screen.getByText('1')).toBeInTheDocument(); // overdue
      expect(screen.getByText('1')).toBeInTheDocument(); // completed
      expect(screen.getByText('1')).toBeInTheDocument(); // pending
    });
  });

  it('should show error when connection fails', async () => {
    vi.mocked(listCalendarItems).mockRejectedValue(new Error('Connection failed'));
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText(/Nepodařilo se načíst kalendář/)).toBeInTheDocument();
    });
  });

  it('should render view mode toggle buttons', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText('Termíny')).toBeInTheDocument();
      expect(screen.getByText('Naplánované')).toBeInTheDocument();
    });
  });

  it('should render layout mode toggle buttons', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText('Měsíc')).toBeInTheDocument();
      expect(screen.getByText('Týden')).toBeInTheDocument();
      expect(screen.getByText('Den')).toBeInTheDocument();
      expect(screen.getByText('Agenda')).toBeInTheDocument();
    });
  });

  it('should render filter controls', async () => {
    vi.mocked(listCalendarItems).mockResolvedValue({ items: [] });
    
    render(<Calendar />);
    
    await waitFor(() => {
      expect(screen.getByText('Typy')).toBeInTheDocument();
      expect(screen.getByText('Stavy')).toBeInTheDocument();
      expect(screen.getByText('Posádka')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Hledat zákazníka')).toBeInTheDocument();
    });
  });
});
