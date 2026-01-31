import type { Revision } from '@shared/revision';
import type { CalendarDay } from '../../utils/calendarUtils';
import { getMonthDays, groupRevisionsByDay } from '../../utils/calendarUtils';
import { DayCell } from './DayCell';
import styles from './CalendarGrid.module.css';

interface CalendarGridProps {
  year: number;
  month: number;
  revisions: Revision[];
  /** Which date field to group by: 'due' or 'scheduled' */
  dateField?: 'due' | 'scheduled';
  onDayClick?: (day: CalendarDay, revisions: Revision[]) => void;
}

const WEEKDAY_NAMES = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

/**
 * Calendar grid component displaying a month with revisions
 */
export function CalendarGrid({ year, month, revisions, dateField = 'due', onDayClick }: CalendarGridProps) {
  const days = getMonthDays(year, month);
  const revisionsByDay = groupRevisionsByDay(revisions, dateField);

  return (
    <div className={styles.grid}>
      {/* Weekday headers */}
      <div className={styles.weekdays}>
        {WEEKDAY_NAMES.map((name) => (
          <div key={name} className={styles.weekday}>
            {name}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className={styles.days}>
        {days.map((day) => (
          <DayCell
            key={day.dateKey}
            day={day}
            revisions={revisionsByDay[day.dateKey] || []}
            onClick={onDayClick}
          />
        ))}
      </div>
    </div>
  );
}
