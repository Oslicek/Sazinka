import type { CalendarItem } from '@shared/calendar';
import type { CalendarDay } from '../../utils/calendarUtils';
import { getItemCountClass } from '../../utils/calendarUtils';
import { useTranslation } from 'react-i18next';
import styles from './DayCell.module.css';

interface DayCellProps {
  day: CalendarDay;
  items: CalendarItem[];
  onClick?: (day: CalendarDay, items: CalendarItem[]) => void;
  workloadMinutes?: number;
  capacityMinutes?: number;
  variant?: 'month' | 'week';
  isSelected?: boolean;
}

/**
 * Renders a single day cell in the calendar grid
 */
export function DayCell({ day, items, onClick, workloadMinutes, capacityMinutes, variant = 'month', isSelected = false }: DayCellProps) {
  const { t } = useTranslation('calendar');
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
        ${isSelected ? styles.selected : ''}
      `}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${day.dateKey}, ${t('items_count', { count: items.length })}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      <span className={styles.dayNumber}>{day.dayNumber}</span>
      
      {variant === 'month' && items.length > 0 && (
        <>
          <div className={styles.monthItems}>
            {sortedItems.slice(0, 3).map((item) => (
              <div key={`${item.type}-${item.id}`} className={styles.monthItem}>
                <span className={styles.monthItemTime}>{item.timeStart?.substring(0, 5) || '--'}</span>
                <span className={styles.monthItemTitle}>{item.customerName || item.title}</span>
              </div>
            ))}
            {items.length > 3 && (
              <div className={styles.monthItemMore}>+{items.length - 3}</div>
            )}
          </div>
          <div className={styles.indicators}>
            {hasScheduled && <span className={styles.scheduledDot} title={t('status_scheduled')} />}
            {hasOverdue && <span className={styles.overdueDot} title={t('status_overdue')} />}
            {hasInProgress && <span className={styles.inProgressDot} title={t('status_in_progress')} />}
            <span className={styles.count}>
              {revisionCount}/{visitCount}/{taskCount}
            </span>
          </div>
        </>
      )}

      {variant === 'week' && (
        <div className={styles.weekItems}>
          {sortedItems.slice(0, 10).map((item) => (
            <div key={`${item.type}-${item.id}`} className={styles.weekItem}>
              <span className={styles.weekItemTime}>{item.timeStart?.substring(0, 5) || '--:--'}</span>
              <span className={styles.weekItemTitle}>{item.customerName || item.title}</span>
              <span className={styles.weekItemType}>
                {item.type === 'revision' ? t('type_revision_singular') : item.type === 'visit' ? t('type_visit_singular') : t('type_task')}
              </span>
            </div>
          ))}
          {items.length > 10 && (
            <div className={styles.weekItemMore}>{t('more_items', { count: items.length - 10 })}</div>
          )}
        </div>
      )}
    </div>
  );
}
