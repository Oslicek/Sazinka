import styles from './CandidateRow.module.css';

export type SlotStatus = 'ok' | 'tight' | 'conflict';

export interface CandidateRowData {
  id: string;
  customerName: string;
  city: string;
  deviceType?: string;
  daysUntilDue: number;
  hasPhone: boolean;
  hasValidAddress: boolean;
  priority: 'overdue' | 'due_this_week' | 'due_soon' | 'upcoming';
  // Route-aware metrics (optional)
  deltaKm?: number;
  deltaMin?: number;
  slotStatus?: SlotStatus;
  suggestedSlots?: Array<{
    label: string;
    status: SlotStatus;
  }>;
}

interface CandidateRowProps {
  candidate: CandidateRowData;
  isSelected?: boolean;
  isRouteAware?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

function getStatusIcon(status?: SlotStatus): string {
  switch (status) {
    case 'ok': return '✅';
    case 'tight': return '⚠️';
    case 'conflict': return '❌';
    default: return '';
  }
}

function formatDelta(value: number | undefined, unit: string): string | null {
  if (value === undefined) return null;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}${unit}`;
}

function getPriorityLabel(priority: CandidateRowData['priority']): string {
  switch (priority) {
    case 'overdue': return 'Po termínu';
    case 'due_this_week': return 'Tento týden';
    case 'due_soon': return 'Brzy';
    case 'upcoming': return 'Nadcházející';
  }
}

export function CandidateRow({
  candidate,
  isSelected,
  isRouteAware = true,
  onClick,
  onKeyDown,
}: CandidateRowProps) {
  const daysOverdue = candidate.daysUntilDue < 0 ? Math.abs(candidate.daysUntilDue) : 0;
  const hasProblems = !candidate.hasPhone || !candidate.hasValidAddress;

  return (
    <button
      type="button"
      className={`${styles.row} ${isSelected ? styles.selected : ''} ${hasProblems ? styles.hasProblems : ''}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-candidate-id={candidate.id}
    >
      <div className={styles.main}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{candidate.customerName}</span>
          {candidate.priority === 'overdue' && (
            <span className={styles.priorityBadge} data-priority="overdue">
              +{daysOverdue}d
            </span>
          )}
        </div>
        <div className={styles.meta}>
          <span className={styles.city}>{candidate.city}</span>
          {candidate.deviceType && (
            <>
              <span className={styles.separator}>•</span>
              <span className={styles.device}>{candidate.deviceType}</span>
            </>
          )}
        </div>
      </div>

      {isRouteAware && (candidate.deltaKm !== undefined || candidate.deltaMin !== undefined) && (
        <div className={styles.metrics}>
          {formatDelta(candidate.deltaKm, 'km') && (
            <span className={styles.deltaKm}>{formatDelta(candidate.deltaKm, 'km')}</span>
          )}
          {formatDelta(candidate.deltaMin, 'min') && (
            <span className={styles.deltaMin}>{formatDelta(candidate.deltaMin, 'min')}</span>
          )}
          {candidate.slotStatus && (
            <span className={`${styles.statusIcon} ${styles[candidate.slotStatus]}`}>
              {getStatusIcon(candidate.slotStatus)}
            </span>
          )}
        </div>
      )}

      {isRouteAware && candidate.suggestedSlots && candidate.suggestedSlots.length > 0 && (
        <div className={styles.slots}>
          {candidate.suggestedSlots.slice(0, 3).map((slot, idx) => (
            <span 
              key={idx} 
              className={`${styles.slotChip} ${styles[slot.status]}`}
            >
              {slot.label}
            </span>
          ))}
        </div>
      )}

      <div className={styles.warnings}>
        {!candidate.hasPhone && (
          <span className={styles.warning} title="Chybí telefon">📵</span>
        )}
        {!candidate.hasValidAddress && (
          <span className={styles.warning} title="Nelze geolokalizovat">📍</span>
        )}
      </div>
    </button>
  );
}
