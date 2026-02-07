import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from '@tanstack/react-router';
import type { PlannedRouteStop } from '@shared/route';
import styles from './SortableStopItem.module.css';

interface SortableStopItemProps {
  stop: PlannedRouteStop;
  index: number;
  isLocked?: boolean;
  onLockToggle?: (customerId: string) => void;
  onNavigate?: () => void;
  onCall?: () => void;
  onMarkDone?: () => void;
  isCompleted?: boolean;
}

export function SortableStopItem({ 
  stop, 
  index, 
  isLocked, 
  onLockToggle,
  onNavigate,
  onCall,
  onMarkDone,
  isCompleted,
}: SortableStopItemProps) {
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
      className={`${styles.stopItem} ${isDragging ? styles.dragging : ''} ${isLocked ? styles.locked : ''} ${isCompleted ? styles.completed : ''}`}
      {...attributes}
    >
      <div className={styles.dragHandle} {...listeners}>
        <span className={styles.dragIcon}>⋮⋮</span>
      </div>
      
      <span className={styles.stopOrder}>{index + 1}</span>
      
      <div className={styles.stopInfo}>
        <div className={styles.stopHeader}>
          <Link to="/customers/$customerId" params={{ customerId: stop.customerId }} className={styles.customerLink}>
            <strong className={styles.customerName}>{stop.customerName}</strong>
          </Link>
          <span className={styles.timeWindow}>{stop.eta} - {stop.etd}</span>
        </div>
        
        <div className={styles.address}>{stop.address}</div>
      </div>
      
      <div className={styles.actions}>
        {onNavigate && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={onNavigate}
            title="Navigovat"
          >
            🧭
          </button>
        )}
        
        {onCall && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={onCall}
            title="Zavolat"
          >
            📞
          </button>
        )}
        
        {onMarkDone && !isCompleted && (
          <button
            type="button"
            className={`${styles.actionButton} ${styles.doneButton}`}
            onClick={onMarkDone}
            title="Hotovo"
          >
            ✅
          </button>
        )}
        
        {onLockToggle && (
          <button
            type="button"
            className={styles.lockButton}
            onClick={() => onLockToggle(stop.customerId)}
            title={isLocked ? 'Odemknout' : 'Zamknout'}
          >
            {isLocked ? '🔒' : '🔓'}
          </button>
        )}
      </div>
    </li>
  );
}
