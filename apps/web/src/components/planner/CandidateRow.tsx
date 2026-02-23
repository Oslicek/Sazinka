import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, AlertTriangle, X as XIcon, Calendar, Car, MapPin, PhoneOff } from 'lucide-react';
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
  /** Stop has late arrival — agreed time needs rescheduling */
  needsReschedule?: boolean;
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

function getStatusIcon(status?: SlotStatus): ReactNode {
  switch (status) {
    case 'ok': return <Check size={14} />;
    case 'tight': return <AlertTriangle size={14} />;
    case 'conflict': return <XIcon size={14} />;
    default: return null;
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
        {candidate.needsReschedule && (
          <span title={t('candidate_row_needs_reschedule', { defaultValue: 'Need to arrange new time' })}><AlertTriangle size={14} className={`${styles.stateIcon} ${styles.rescheduleIcon}`} /></span>
        )}
        {candidate.isScheduled && (
          <span title={t('candidate_row_has_appointment')}><Calendar size={14} className={styles.stateIcon} /></span>
        )}
        {(isInRoute || candidate.isInRoute) && (
          <span title={t('candidate_row_in_route')}><Car size={14} className={styles.stateIcon} /></span>
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
          <span title={t('candidate_row_no_phone')}><PhoneOff size={14} className={styles.warning} /></span>
        )}
        {!candidate.hasValidAddress && (
          <span title={t('candidate_row_no_address')}><MapPin size={14} className={`${styles.warning} ${styles.noGeo}`} /></span>
        )}
      </div>
    </button>
  );
}
