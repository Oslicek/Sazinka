import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlannedRouteStop } from '@sazinka/shared-types';
import styles from './SortableStopItem.module.css';

interface SortableStopItemProps {
  stop: PlannedRouteStop;
  index: number;
  isLocked?: boolean;
  onLockToggle?: (customerId: string) => void;
}

export function SortableStopItem({ stop, index, isLocked, onLockToggle }: SortableStopItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: stop.customerId,
    disabled: isLocked,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${styles.stopItem} ${isDragging ? styles.dragging : ''} ${isLocked ? styles.locked : ''}`}
      {...attributes}
    >
      <div className={styles.dragHandle} {...listeners}>
        <span className={styles.dragIcon}>⋮⋮</span>
      </div>
      <span className={styles.stopOrder}>{index + 1}</span>
      <div className={styles.stopInfo}>
        <strong>{stop.customerName}</strong>
        <small>{stop.address}</small>
        <small className={styles.stopTime}>
          {stop.eta} - {stop.etd}
        </small>
      </div>
      {onLockToggle && (
        <button
          type="button"
          className={styles.lockButton}
          onClick={() => onLockToggle(stop.customerId)}
          title={isLocked ? 'Odemknout pozici' : 'Zamknout pozici'}
        >
          {isLocked ? '🔒' : '🔓'}
        </button>
      )}
    </li>
  );
}
