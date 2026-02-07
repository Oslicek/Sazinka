import type { Revision } from '@shared/revision';
import type { CalendarDay } from '../../utils/calendarUtils';
import { getRevisionCountClass } from '../../utils/calendarUtils';
import styles from './DayCell.module.css';

interface DayCellProps {
  day: CalendarDay;
  revisions: Revision[];
  onClick?: (day: CalendarDay, revisions: Revision[]) => void;
}

/**
 * Renders a single day cell in the calendar grid
 */
export function DayCell({ day, revisions, onClick }: DayCellProps) {
  const countClass = getRevisionCountClass(revisions.length);
  
  const handleClick = () => {
    onClick?.(day, revisions);
  };

  const now = new Date();
  const hasOverdue = revisions.some(r => {
    if (r.status === 'completed' || r.status === 'cancelled') return false;
    return new Date(r.dueDate) < now;
  });
  const hasScheduled = revisions.some(r => r.status === 'scheduled' || r.status === 'confirmed');

  return (
    <div
      className={`
        ${styles.cell}
        ${!day.isCurrentMonth ? styles.otherMonth : ''}
        ${day.isToday ? styles.today : ''}
        ${countClass ? styles[countClass] : ''}
        ${hasOverdue ? styles.hasOverdue : ''}
      `}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${day.dateKey}, ${revisions.length} revizí`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <span className={styles.dayNumber}>{day.dayNumber}</span>
      
      {revisions.length > 0 && (
        <div className={styles.indicators}>
          {hasScheduled && <span className={styles.scheduledDot} title="Naplánováno" />}
          {hasOverdue && <span className={styles.overdueDot} title="Po termínu" />}
          <span className={styles.count}>{revisions.length}</span>
        </div>
      )}
    </div>
  );
}
