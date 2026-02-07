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
  variant?: 'month' | 'week';
}

/**
 * Renders a single day cell in the calendar grid
 */
export function DayCell({ day, items, onClick, workloadMinutes, capacityMinutes, variant = 'month' }: DayCellProps) {
  const countClass = getItemCountClass(items.length);
  const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
  
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

  const sortedItems = [...items].sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''));

  return (
    <div
      className={`
        ${styles.cell}
        ${variant === 'week' ? styles.weekCell : ''}
        ${!day.isCurrentMonth ? styles.otherMonth : ''}
        ${day.isToday ? styles.today : ''}
        ${countClass ? styles[countClass] : ''}
        ${hasOverdue ? styles.hasOverdue : ''}
        ${isOverCapacity ? styles.overCapacity : ''}
        ${isWeekend ? styles.weekend : ''}
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
      
      {variant === 'month' && items.length > 0 && (
        <div className={styles.indicators}>
          {hasScheduled && <span className={styles.scheduledDot} title="Naplánováno" />}
          {hasOverdue && <span className={styles.overdueDot} title="Po termínu" />}
          {hasInProgress && <span className={styles.inProgressDot} title="Probíhá" />}
          <span className={styles.count}>
            {revisionCount}/{visitCount}/{taskCount}
          </span>
        </div>
      )}

      {variant === 'week' && (
        <div className={styles.weekItems}>
          {sortedItems.slice(0, 8).map((item) => (
            <div key={`${item.type}-${item.id}`} className={styles.weekItem}>
              <span className={styles.weekItemTime}>{item.timeStart?.substring(0, 5) || '--:--'}</span>
              <span className={styles.weekItemTitle}>{item.customerName || item.title}</span>
              <span className={styles.weekItemType}>
                {item.type === 'revision' ? 'R' : item.type === 'visit' ? 'N' : 'F'}
              </span>
            </div>
          ))}
          {items.length > 8 && (
            <div className={styles.weekItemMore}>+{items.length - 8} dalších</div>
          )}
        </div>
      )}
    </div>
  );
}
