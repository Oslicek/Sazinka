import { useState, useMemo } from 'react';
import { CandidateDetail, type CandidateDetailData, type SlotSuggestion } from '@/components/planner';
import { usePanelState } from '@/hooks/usePanelState';
import type { SavedRouteStop } from '@/services/routeService';

export interface CustomerDetailPanelProps {
  mode: 'inbox' | 'plan';
  /** Controls visibility in plan mode */
  isOpen?: boolean;
  /** Route stops used in plan mode to derive candidate data for the selected customer */
  routeStops?: SavedRouteStop[];
  onSchedule?: (candidateId: string, date: string, timeStart: string, timeEnd: string) => void;
  onSnooze?: (candidateId: string, days: number) => void;
  onAddToRoute?: (candidateId: string) => void;
}

export function CustomerDetailPanel({
  mode,
  isOpen,
  routeStops,
  onSchedule,
  onSnooze,
  onAddToRoute,
}: CustomerDetailPanelProps) {
  const { state, actions } = usePanelState();
  const { selectedCustomerId } = state;

  const [slotSuggestions] = useState<SlotSuggestion[]>([]);
  const [isCalculatingSlots] = useState(false);
  const [scheduledConfirmation] = useState<string | null>(null);

  const isVisible = mode === 'inbox'
    ? selectedCustomerId !== null
    : isOpen === true;

  // Derive minimal CandidateDetailData from the matching route stop (plan mode)
  const candidate: CandidateDetailData | null = useMemo(() => {
    if (!selectedCustomerId) return null;

    if (mode === 'plan' && routeStops) {
      const stop = routeStops.find(
        (s) => s.customerId === selectedCustomerId && s.stopType === 'customer',
      );
      if (stop) {
        return {
          id: stop.revisionId ?? stop.id,
          customerId: stop.customerId!,
          customerName: stop.customerName ?? '',
          deviceType: '',
          street: stop.address ?? '',
          city: '',
          dueDate: stop.scheduledDate ?? '',
          daysUntilDue: 0,
          priority: 'upcoming',
        };
      }
    }

    return null;
  }, [selectedCustomerId, mode, routeStops]);

  if (!isVisible) return null;

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
