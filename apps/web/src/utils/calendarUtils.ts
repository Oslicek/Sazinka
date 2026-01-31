import type { Revision } from '@shared/revision';

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
function formatDateKey(date: Date): string {
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
 * Group revisions by a specific date field
 * @param revisions - list of revisions to group
 * @param dateField - which date field to use: 'due' for dueDate, 'scheduled' for scheduledDate
 * Returns a map of dateKey -> revisions[]
 */
export function groupRevisionsByDay(
  revisions: Revision[], 
  dateField: 'due' | 'scheduled' = 'due'
): Record<string, Revision[]> {
  const grouped: Record<string, Revision[]> = {};

  for (const revision of revisions) {
    // Use the specified date field
    const dateStr = dateField === 'scheduled' 
      ? revision.scheduledDate 
      : revision.dueDate;
    
    if (!dateStr) {
      continue;
    }

    // Normalize date string to YYYY-MM-DD
    const dateKey = dateStr.substring(0, 10);

    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(revision);
  }

  return grouped;
}

/**
 * Get CSS class based on revision count for a day
 */
export function getRevisionCountClass(count: number): string {
  if (count === 0) return '';
  if (count <= 2) return 'low';
  if (count <= 5) return 'medium';
  return 'high';
}
