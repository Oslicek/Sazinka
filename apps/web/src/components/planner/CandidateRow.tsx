import { useTranslation } from 'react-i18next';
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
  // State flags
  isScheduled?: boolean;
  isInRoute?: boolean;
  disableCheckbox?: boolean;
}

interface CandidateRowProps {
  candidate: CandidateRowData;
  isSelected?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Show a checkbox for batch selection */
  selectable?: boolean;
  /** Whether this row's checkbox is checked */
  checked?: boolean;
  /** Called when checkbox state changes */
  onCheckChange?: (checked: boolean) => void;
  /** Whether this candidate is already in the route */
  isInRoute?: boolean;
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
    case 'overdue': return 'candidate_row_overdue';
    case 'due_this_week': return 'candidate_row_this_week';
    case 'due_soon': return 'candidate_row_soon';
    case 'upcoming': return 'candidate_row_planned';
  }
}

export function CandidateRow({
  candidate,
  isSelected,
  onClick,
  onKeyDown,
  selectable = false,
  checked = false,
  onCheckChange,
  isInRoute = false,
}: CandidateRowProps) {
  const { t } = useTranslation('planner');
  const daysOverdue = candidate.daysUntilDue < 0 ? Math.abs(candidate.daysUntilDue) : 0;
  const hasProblems = !candidate.hasPhone || !candidate.hasValidAddress;

  return (
    <button
      type="button"
      className={`${styles.row} ${isSelected ? styles.selected : ''} ${hasProblems ? styles.hasProblems : ''} ${isInRoute ? styles.inRoute : ''}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-candidate-id={candidate.id}
    >
      {selectable && (
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          disabled={candidate.disableCheckbox}
          title={candidate.disableCheckbox ? t('candidate_row_checkbox_disabled') : undefined}
          onChange={(e) => {
            e.stopPropagation();
            onCheckChange?.(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className={styles.stateIcons}>
        {candidate.isScheduled && (
          <span className={styles.stateIcon} title={t('candidate_row_has_appointment')}>📅</span>
        )}
        {(isInRoute || candidate.isInRoute) && (
          <span className={styles.stateIcon} title={t('candidate_row_in_route')}>🚗</span>
        )}
      </div>
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

      {(candidate.deltaKm !== undefined || candidate.deltaMin !== undefined) && (
        <div className={styles.metrics}>
          {formatDelta(candidate.deltaKm, 'km') && (
            <span className={styles.deltaKm} title={t('candidate_row_delta_km')}>
              {formatDelta(candidate.deltaKm, 'km')}
            </span>
          )}
          {formatDelta(candidate.deltaMin, 'min') && (
            <span className={styles.deltaMin} title={t('candidate_row_delta_min')}>
              {formatDelta(candidate.deltaMin, 'min')}
            </span>
          )}
          {candidate.slotStatus && (
            <span
              className={`${styles.statusIcon} ${styles[candidate.slotStatus]}`}
              title={
                candidate.slotStatus === 'ok'
                  ? t('candidate_row_slot_ok')
                  : candidate.slotStatus === 'tight'
                    ? t('candidate_row_slot_tight')
                    : t('candidate_row_slot_conflict')
              }
            >
              {getStatusIcon(candidate.slotStatus)}
            </span>
          )}
        </div>
      )}

      {candidate.suggestedSlots && candidate.suggestedSlots.length > 0 && (
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
          <span className={styles.warning} title={t('candidate_row_no_phone')}>📵</span>
        )}
        {!candidate.hasValidAddress && (
          <span className={`${styles.warning} ${styles.noGeo}`} title={t('candidate_row_no_address')}>📍</span>
        )}
      </div>
    </button>
  );
}
