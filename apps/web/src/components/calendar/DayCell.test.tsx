import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayCell } from './DayCell';
import type { CalendarDay } from '../../utils/calendarUtils';
import type { CalendarItem } from '@shared/calendar';

describe('DayCell', () => {
  const mockDay: CalendarDay = {
    date: new Date('2026-01-15T00:00:00'),
    dateKey: '2026-01-15',
    dayNumber: 15,
    isCurrentMonth: true,
    isToday: false,
  };

  it('should render day number', () => {
    render(<DayCell day={mockDay} items={[]} />);
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('should render month view with compact items', () => {
    const items: CalendarItem[] = [
      {
        id: '1',
        type: 'revision',
        date: '2026-01-15',
        status: 'scheduled',
        title: 'Customer A',
        customerName: 'Customer A',
        timeStart: '09:00',
      },
      {
        id: '2',
        type: 'visit',
        date: '2026-01-15',
        status: 'scheduled',
        title: 'Customer B',
        customerName: 'Customer B',
        timeStart: '14:00',
      },
    ];

    render(<DayCell day={mockDay} items={items} variant="month" />);

    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Customer A')).toBeInTheDocument();
    expect(screen.getByText('14:00')).toBeInTheDocument();
    expect(screen.getByText('Customer B')).toBeInTheDocument();
  });

  it('should show +N more indicator in month view when more than 3 items', () => {
    const items: CalendarItem[] = [
      { id: '1', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'A', timeStart: '08:00' },
      { id: '2', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'B', timeStart: '09:00' },
      { id: '3', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'C', timeStart: '10:00' },
      { id: '4', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'D', timeStart: '11:00' },
      { id: '5', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'E', timeStart: '12:00' },
    ];

    render(<DayCell day={mockDay} items={items} variant="month" />);

    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('should render week view with detailed items', () => {
    const items: CalendarItem[] = [
      {
        id: '1',
        type: 'revision',
        date: '2026-01-15',
        status: 'scheduled',
        title: 'Customer A',
        customerName: 'Customer A',
        timeStart: '09:00',
      },
    ];

    render(<DayCell day={mockDay} items={items} variant="week" />);

    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Customer A')).toBeInTheDocument();
    expect(screen.getByText('Revize')).toBeInTheDocument();
  });

  it('should show status indicators in month view', () => {
    const items: CalendarItem[] = [
      { id: '1', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'A' },
      { id: '2', type: 'visit', date: '2026-01-15', status: 'overdue', title: 'B' },
      { id: '3', type: 'task', date: '2026-01-15', status: 'in_progress', title: 'C' },
    ];

    render(<DayCell day={mockDay} items={items} variant="month" />);

    // Check count format: revisions/visits/tasks
    expect(screen.getByText('1/1/1')).toBeInTheDocument();
  });

  it('should highlight today', () => {
    const todayDay: CalendarDay = {
      ...mockDay,
      isToday: true,
    };

    const { container } = render(<DayCell day={todayDay} items={[]} />);
    const cell = container.querySelector('.today');
    expect(cell).toBeInTheDocument();
  });

  it('should highlight weekend days', () => {
    const saturdayDay: CalendarDay = {
      date: new Date('2026-01-17T00:00:00'), // Saturday
      dateKey: '2026-01-17',
      dayNumber: 17,
      isCurrentMonth: true,
      isToday: false,
    };

    const { container } = render(<DayCell day={saturdayDay} items={[]} />);
    const cell = container.querySelector('.weekend');
    expect(cell).toBeInTheDocument();
  });

  it('should show over-capacity indicator', () => {
    const items: CalendarItem[] = [
      { id: '1', type: 'revision', date: '2026-01-15', status: 'scheduled', title: 'A' },
    ];

    const { container } = render(
      <DayCell day={mockDay} items={items} workloadMinutes={600} capacityMinutes={480} />
    );
    
    const cell = container.querySelector('.overCapacity');
    expect(cell).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    const items: CalendarItem[] = [];

    render(<DayCell day={mockDay} items={items} onClick={onClick} />);

    const cell = screen.getByRole('button');
    cell.click();

    expect(onClick).toHaveBeenCalledWith(mockDay, items);
  });
});
