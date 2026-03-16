import { useState } from 'react';
import { CandidateDetail, type CandidateDetailData, type SlotSuggestion } from '@/components/planner';
import { usePanelState } from '@/hooks/usePanelState';

export interface CustomerDetailPanelProps {
  mode: 'inbox' | 'plan';
  /** Controls visibility in plan mode */
  isOpen?: boolean;
  onSchedule?: (candidateId: string, date: string, timeStart: string, timeEnd: string) => void;
  onSnooze?: (candidateId: string, days: number) => void;
  onAddToRoute?: (candidateId: string) => void;
}

export function CustomerDetailPanel({
  mode,
  isOpen,
  onSchedule,
  onSnooze,
  onAddToRoute,
}: CustomerDetailPanelProps) {
  const { state, actions } = usePanelState();
  const { selectedCustomerId } = state;

  // Local panel state (full logic wired in A.6/A.7)
  const [slotSuggestions] = useState<SlotSuggestion[]>([]);
  const [isCalculatingSlots] = useState(false);
  const [scheduledConfirmation] = useState<string | null>(null);

  const isVisible = mode === 'inbox'
    ? selectedCustomerId !== null
    : isOpen === true;

  if (!isVisible) return null;

  // Stub candidate — data fetching wired in A.6/A.7
  const candidate: CandidateDetailData | null = null;

  return (
    <div data-testid="customer-detail-panel">
      <button
        type="button"
        aria-label="close"
        onClick={() => actions.selectCustomer(null)}
      >
        ×
      </button>
      <CandidateDetail
        candidate={candidate}
        isLoading={isCalculatingSlots}
        onSchedule={onSchedule
          ? (id, slot) => onSchedule(id, slot.date, slot.timeStart, slot.timeEnd)
          : undefined}
        onSnooze={onSnooze
          ? (id, days) => onSnooze(id, days)
          : undefined}
        onAddToRoute={onAddToRoute}
      />
      {scheduledConfirmation && (
        <div data-testid="scheduled-confirmation">{scheduledConfirmation}</div>
      )}
      {slotSuggestions.length > 0 && (
        <div data-testid="slot-suggestions-count">{slotSuggestions.length}</div>
      )}
    </div>
  );
}
