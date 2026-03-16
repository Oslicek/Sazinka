import { useState, useEffect, useCallback, useRef } from 'react';
import { VirtualizedInboxList } from '@/components/planner';
import { usePanelState } from '@/hooks/usePanelState';
import { useNatsStore } from '@/stores/natsStore';
import { getInbox } from '@/services/inboxService';
import { inboxResponseToCallQueueResponse } from '@/services/inboxAdapter';
import { listRuleSets, getInboxState, saveInboxState } from '@/services/scoringService';
import * as routeService from '@/services/routeService';
import type { CandidateRowData } from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';
import type { ScoringRuleSet } from '@/services/scoringService';

interface InboxListPanelProps {
  /** Override internal candidates — for tests */
  candidates?: CandidateRowData[];
  /** Override internal loading state — for tests */
  isLoading?: boolean;
}

export function InboxListPanel({ candidates: candidatesProp, isLoading: isLoadingProp }: InboxListPanelProps) {
  const { state, actions } = usePanelState();
  const { isConnected } = useNatsStore();

  const [candidates, setCandidates] = useState<CandidateRowData[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [routeStops, setRouteStops] = useState<SavedRouteStop[]>([]);
  const [_ruleSets, setRuleSets] = useState<ScoringRuleSet[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null>(null);
  const inboxStateLoadedRef = useRef(false);

  const routeContext = state.routeContext;

  // Load rule sets and persisted inbox state on connect
  useEffect(() => {
    if (!isConnected) return;
    Promise.all([
      listRuleSets(false),
      inboxStateLoadedRef.current ? Promise.resolve(null) : getInboxState().catch(() => null),
    ])
      .then(([sets, savedState]) => {
        const activeSets = sets.filter((rs) => !rs.isArchived);
        setRuleSets(activeSets);
        if (!inboxStateLoadedRef.current) {
          inboxStateLoadedRef.current = true;
          if (savedState?.selectedRuleSetId) {
            setSelectedRuleSetId(savedState.selectedRuleSetId);
          } else {
            const defaultSet = activeSets.find((rs) => rs.isDefault);
            if (defaultSet) setSelectedRuleSetId(defaultSet.id);
          }
        }
      })
      .catch(() => setRuleSets([]));
  }, [isConnected]);

  // Persist selected rule set
  useEffect(() => {
    if (!isConnected || !inboxStateLoadedRef.current) return;
    saveInboxState({ selectedRuleSetId: selectedRuleSetId ?? null }).catch(() => {});
  }, [isConnected, selectedRuleSetId]);

  // Fetch candidates when connected, rule set, or route context (date) changes
  const loadCandidates = useCallback(async () => {
    if (!isConnected) return;
    setIsLoadingCandidates(true);
    try {
      const inboxResponse = await getInbox({
        limit: 100,
        selectedRuleSetId: selectedRuleSetId ?? undefined,
      });
      const response = inboxResponseToCallQueueResponse(inboxResponse);
      const loaded: CandidateRowData[] = response.items.map((item) => ({
        ...item,
        deltaKm: undefined,
        deltaMin: undefined,
        slotStatus: undefined,
        suggestedSlots: undefined,
      }));
      setCandidates(loaded);
    } catch {
      setCandidates([]);
    } finally {
      setIsLoadingCandidates(false);
    }
  // routeContext?.date intentionally included — re-fetch when day changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, selectedRuleSetId, routeContext?.date]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Load route stops for current context to derive in-route set
  useEffect(() => {
    if (!isConnected || !routeContext?.date) return;
    routeService
      .getRoute({ date: routeContext.date })
      .then((res) => {
        setRouteStops((res as { route: unknown; stops: SavedRouteStop[] }).stops ?? []);
      })
      .catch(() => setRouteStops([]));
  }, [isConnected, routeContext?.date]);

  // Keep PanelState routeStops in sync (for other panels that read it)
  useEffect(() => {
    actions.setRouteStops(routeStops);
  }, [routeStops, actions]);

  const inRouteIds = new Set<string>(
    routeStops.map((s) => s.customerId).filter((id): id is string => id !== null)
  );

  const resolvedCandidates = candidatesProp ?? candidates;
  const resolvedIsLoading = isLoadingProp ?? isLoadingCandidates;

  return (
    <VirtualizedInboxList
      candidates={resolvedCandidates}
      selectedCandidateId={state.selectedCustomerId}
      onCandidateSelect={(id) => actions.selectCustomer(id)}
      isLoading={resolvedIsLoading}
      inRouteIds={inRouteIds}
      selectedIds={new Set<string>()}
    />
  );
}
