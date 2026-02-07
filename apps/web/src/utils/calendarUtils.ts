import type { CalendarItem } from '@shared/calendar';

/**
 * Represents a day in the calendar grid
 */
export interface CalendarDay {
  date: Date;
  dateKey: string; // YYYY-MM-DD format for grouping
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

/**
 * Get start and end dates for a month in YYYY-MM-DD format
 */
export function getMonthRange(year: number, month: number): { start: string; end: string } {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0); // Last day of month

  return {
    start: formatDateKey(startDate),
    end: formatDateKey(endDate),
  };
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get all days to display in a calendar month grid (6 rows × 7 days = 42 days)
 * Includes padding days from previous and next months
 */
export function getMonthDays(year: number, month: number): CalendarDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Get the day of week for the first day (0 = Sunday, convert to Monday-based)
  let startDayOfWeek = firstDayOfMonth.getDay();
  // Convert Sunday = 0 to Sunday = 6 (for Monday-first week)
  startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const days: CalendarDay[] = [];

  // Add padding days from previous month
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const date = new Date(year, month, -i);
    days.push(createCalendarDay(date, month, today));
  }

  // Add days of current month
  for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
    const date = new Date(year, month, day);
    days.push(createCalendarDay(date, month, today));
  }

  // Add padding days from next month to fill 6 rows (42 days)
  const remainingDays = 42 - days.length;
  for (let day = 1; day <= remainingDays; day++) {
    const date = new Date(year, month + 1, day);
    days.push(createCalendarDay(date, month, today));
  }

  return days;
}

/**
 * Get days for a Monday-starting week that includes the provided date
 */
export function getWeekDays(date: Date): CalendarDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const dayOfWeek = target.getDay(); // 0 = Sunday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = new Date(target);
  start.setDate(target.getDate() + diffToMonday);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    days.push(createCalendarDay(current, target.getMonth(), today));
  }

  return days;
}

/**
 * Create a CalendarDay object
 */
function createCalendarDay(date: Date, currentMonth: number, today: Date): CalendarDay {
  return {
    date,
    dateKey: formatDateKey(date),
    dayNumber: date.getDate(),
    isCurrentMonth: date.getMonth() === currentMonth,
    isToday: date.getTime() === today.getTime(),
  };
}

/**
 * Group calendar items by day
 * Returns a map of dateKey -> items[]
 */
export function groupItemsByDay(items: CalendarItem[]): Record<string, CalendarItem[]> {
  const grouped: Record<string, CalendarItem[]> = {};

  for (const item of items) {
    if (!item.date) continue;
    if (!grouped[item.date]) {
      grouped[item.date] = [];
    }
    grouped[item.date].push(item);
  }

  return grouped;
}

/**
 * Get CSS class based on item count for a day
 */
export function getItemCountClass(count: number): string {
  if (count === 0) return '';
  if (count <= 2) return 'low';
  if (count <= 5) return 'medium';
  return 'high';
}

/**
 * Estimate workload minutes for a calendar item
 */
export function getEstimatedMinutes(item: CalendarItem): number {
  if (item.timeStart && item.timeEnd) {
    const [startH, startM] = item.timeStart.split(':').map(Number);
    const [endH, endM] = item.timeEnd.split(':').map(Number);
    if (!Number.isNaN(startH) && !Number.isNaN(endH)) {
      const minutes = (endH * 60 + endM) - (startH * 60 + startM);
      if (minutes > 0) return minutes;
    }
  }
  if (item.type === 'task') return 15;
  if (item.type === 'visit') return 60;
  return 60;
}
