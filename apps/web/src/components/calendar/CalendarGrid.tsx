import type { CalendarItem } from '@shared/calendar';
import type { CalendarDay } from '../../utils/calendarUtils';
import { getMonthDays, groupItemsByDay } from '../../utils/calendarUtils';
import { DayCell } from './DayCell';
import styles from './CalendarGrid.module.css';

interface CalendarGridProps {
  year: number;
  month: number;
  items: CalendarItem[];
  onDayClick?: (day: CalendarDay, items: CalendarItem[]) => void;
  workloadByDay?: Record<string, number>;
  capacityByDay?: Record<string, number>;
  selectedDateKey?: string;
}

const WEEKDAY_NAMES = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

/**
 * Calendar grid component displaying a month with revisions
 */
export function CalendarGrid({
  year,
  month,
  items,
  onDayClick,
  workloadByDay = {},
  capacityByDay = {},
  selectedDateKey,
}: CalendarGridProps) {
  const days = getMonthDays(year, month);
  const itemsByDay = groupItemsByDay(items);

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
            items={itemsByDay[day.dateKey] || []}
            onClick={onDayClick}
            workloadMinutes={workloadByDay[day.dateKey]}
            capacityMinutes={capacityByDay[day.dateKey]}
            isSelected={selectedDateKey === day.dateKey}
          />
        ))}
      </div>
    </div>
  );
}
