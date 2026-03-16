import { useState } from 'react';
import { VirtualizedInboxList } from '@/components/planner';
import { usePanelState } from '@/hooks/usePanelState';
import type { CandidateRowData } from '@/components/planner';

interface InboxListPanelProps {
  onAddToRoute?: (candidateId: string) => void;
  onSnooze?: (candidateId: string, days: number) => void;
  /** Override internal candidates — used by tests and in A.6 will be removed in favour of NATS loading */
  candidates?: CandidateRowData[];
  /** Override internal loading state */
  isLoading?: boolean;
}

export function InboxListPanel({
  onAddToRoute: _onAddToRoute,
  onSnooze: _onSnooze,
  candidates: candidatesProp,
  isLoading: isLoadingProp,
}: InboxListPanelProps) {
  const { state, actions } = usePanelState();

  // LOCAL state — stubs until A.6 migrates NATS loading here
  const [candidates] = useState<CandidateRowData[]>([]);
  const [isLoadingCandidates] = useState(false);
  const [selectedIds] = useState<Set<string>>(new Set());

  const resolvedCandidates = candidatesProp ?? candidates;
  const resolvedIsLoading = isLoadingProp ?? isLoadingCandidates;

  const inRouteIds = new Set<string>(
    state.routeStops
      .map((s) => s.customerId)
      .filter((id): id is string => id !== null),
  );

  return (
    <VirtualizedInboxList
      candidates={resolvedCandidates}
      selectedCandidateId={state.selectedCustomerId}
      onCandidateSelect={(id) => {
        actions.selectCustomer(id);
      }}
      isLoading={resolvedIsLoading}
      inRouteIds={inRouteIds}
      selectedIds={selectedIds}
    />
  );
}
