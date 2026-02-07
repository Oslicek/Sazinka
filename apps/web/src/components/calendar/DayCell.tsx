import type { CalendarItem } from '@shared/calendar';
import type { CalendarDay } from '../../utils/calendarUtils';
import { getItemCountClass } from '../../utils/calendarUtils';
import styles from './DayCell.module.css';

interface DayCellProps {
  day: CalendarDay;
  items: CalendarItem[];
  onClick?: (day: CalendarDay, items: CalendarItem[]) => void;
  workloadMinutes?: number;
  capacityMinutes?: number;
}

/**
 * Renders a single day cell in the calendar grid
 */
export function DayCell({ day, items, onClick, workloadMinutes, capacityMinutes }: DayCellProps) {
  const countClass = getItemCountClass(items.length);
  
  const handleClick = () => {
    onClick?.(day, items);
  };

  const revisionCount = items.filter((item) => item.type === 'revision').length;
  const visitCount = items.filter((item) => item.type === 'visit').length;
  const taskCount = items.filter((item) => item.type === 'task').length;

  const hasOverdue = items.some((item) => item.status === 'overdue');
  const hasScheduled = items.some((item) => item.status === 'scheduled');
  const hasInProgress = items.some((item) => item.status === 'in_progress');

  const isOverCapacity =
    typeof workloadMinutes === 'number' &&
    typeof capacityMinutes === 'number' &&
    capacityMinutes > 0 &&
    workloadMinutes > capacityMinutes;

  return (
    <div
      className={`
        ${styles.cell}
        ${!day.isCurrentMonth ? styles.otherMonth : ''}
        ${day.isToday ? styles.today : ''}
        ${countClass ? styles[countClass] : ''}
        ${hasOverdue ? styles.hasOverdue : ''}
        ${isOverCapacity ? styles.overCapacity : ''}
      `}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${day.dateKey}, ${items.length} položek`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <span className={styles.dayNumber}>{day.dayNumber}</span>
      
      {items.length > 0 && (
        <div className={styles.indicators}>
          {hasScheduled && <span className={styles.scheduledDot} title="Naplánováno" />}
          {hasOverdue && <span className={styles.overdueDot} title="Po termínu" />}
          {hasInProgress && <span className={styles.inProgressDot} title="Probíhá" />}
          <span className={styles.count}>
            {revisionCount}/{visitCount}/{taskCount}
          </span>
        </div>
      )}
    </div>
  );
}
