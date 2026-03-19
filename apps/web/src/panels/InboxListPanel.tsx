import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { VirtualizedInboxList } from '@/components/planner';
import { InboxFilterBar } from '@/components/planner/InboxFilterBar';
import { usePanelState } from '@/hooks/usePanelState';
import { useNatsStore } from '@/stores/natsStore';
import { getInbox } from '@/services/inboxService';
import { inboxResponseToCallQueueResponse } from '@/services/inboxAdapter';
import { listRuleSets, getInboxState, saveInboxState } from '@/services/scoringService';
import {
  hasPhone,
  hasValidAddress,
  isScheduledCandidate,
  applyInboxFilters,
  applyFilterPreset,
  normalizeExpression,
  DEFAULT_FILTER_EXPRESSION,
  type InboxFilterExpression,
  type FilterPresetId,
} from '@/pages/planningInboxFilters';
import * as routeService from '@/services/routeService';
import type { CandidateRowData } from '@/components/planner';
import type { CallQueueItem } from '@/services/revisionService';
import type { SavedRouteStop } from '@/services/routeService';
import type { ScoringRuleSet } from '@/services/scoringService';

export function mapCallQueueItemToCandidate(item: CallQueueItem): CandidateRowData {
  const validAddress = hasValidAddress(item);
  return {
    id: item.customerId,
    customerName: item.customerName,
    city: item.customerCity ?? '',
    deviceType: item.deviceType,
    daysUntilDue: item.daysUntilDue,
    hasPhone: hasPhone(item),
    hasValidAddress: validAddress,
    priority: item.priority as CandidateRowData['priority'],
    isScheduled: isScheduledCandidate(item),
    disableCheckbox: !validAddress,
    deltaKm: undefined,
    deltaMin: undefined,
    slotStatus: undefined,
    suggestedSlots: undefined,
  };
}

function sortCandidates(items: CandidateRowData[]): CandidateRowData[] {
  return [...items].sort((a, b) => {
    if (a.hasValidAddress !== b.hasValidAddress) return a.hasValidAddress ? -1 : 1;

    const aHasMetrics = a.deltaMin !== undefined;
    const bHasMetrics = b.deltaMin !== undefined;
    if (aHasMetrics !== bHasMetrics) return aHasMetrics ? -1 : 1;

    if (a.slotStatus && b.slotStatus) {
      const order = { ok: 0, tight: 1, conflict: 2 };
      const diff = order[a.slotStatus] - order[b.slotStatus];
      if (diff !== 0) return diff;
    }

    if (a.deltaMin !== undefined && b.deltaMin !== undefined) return a.deltaMin - b.deltaMin;

    const aOverdue = Math.max(0, -a.daysUntilDue);
    const bOverdue = Math.max(0, -b.daysUntilDue);
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    return a.daysUntilDue - b.daysUntilDue;
  });
}

const SESSION_KEY_FILTERS = 'planningInbox.filters';

function loadPersistedFilters(): InboxFilterExpression {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_FILTERS);
    if (!raw) return DEFAULT_FILTER_EXPRESSION;
    return normalizeExpression(JSON.parse(raw));
  } catch {
    return DEFAULT_FILTER_EXPRESSION;
  }
}

// Module-level cache: survives component remounts caused by layout changes
// (React unmounts/remounts InboxListPanel when its tree position changes)
const _cache = {
  rawCandidates: [] as CallQueueItem[],
  ruleSets: [] as ScoringRuleSet[],
  selectedRuleSetId: null as string | null,
  inboxStateLoaded: false,
};

export function resetInboxListCache(): void {
  _cache.rawCandidates = [];
  _cache.ruleSets = [];
  _cache.selectedRuleSetId = null;
  _cache.inboxStateLoaded = false;
}

interface InboxListPanelProps {
  candidates?: CandidateRowData[];
  isLoading?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (id: string, selected: boolean) => void;
}

export function InboxListPanel({ candidates: candidatesProp, isLoading: isLoadingProp, selectable = false, selectedIds, onSelectionChange }: InboxListPanelProps) {
  const { state, actions } = usePanelState();
  const { isConnected } = useNatsStore();

  const [rawCandidates, setRawCandidatesState] = useState<CallQueueItem[]>(_cache.rawCandidates);
  const [candidates, setCandidates] = useState<CandidateRowData[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(_cache.rawCandidates.length === 0);
  const [selfFetchedStops, setSelfFetchedStops] = useState<SavedRouteStop[]>([]);
  const [ruleSets, setRuleSetsState] = useState<ScoringRuleSet[]>(_cache.ruleSets);
  const [selectedRuleSetId, setSelectedRuleSetIdState] = useState<string | null>(_cache.selectedRuleSetId);
  const [filters, setFilters] = useState<InboxFilterExpression>(loadPersistedFilters);
  const [activePresetId, setActivePresetId] = useState<FilterPresetId | null>(null);
  const inboxStateLoadedRef = useRef(_cache.inboxStateLoaded);

  const setRawCandidates = useCallback((items: CallQueueItem[]) => {
    _cache.rawCandidates = items;
    setRawCandidatesState(items);
  }, []);

  const setRuleSets = useCallback((sets: ScoringRuleSet[]) => {
    _cache.ruleSets = sets;
    setRuleSetsState(sets);
  }, []);

  const setSelectedRuleSetId = useCallback((id: string | null) => {
    _cache.selectedRuleSetId = id;
    setSelectedRuleSetIdState(id);
  }, []);

  const routeContext = state.routeContext;
  // Prefer route stops from PanelState (synced by PlanningInbox bridge);
  // fall back to self-fetched stops (for detached windows)
  const routeStops = state.routeStops.length > 0 ? state.routeStops : selfFetchedStops;

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
          _cache.inboxStateLoaded = true;
          if (savedState?.selectedRuleSetId) {
            setSelectedRuleSetId(savedState.selectedRuleSetId);
          } else {
            const defaultSet = activeSets.find((rs) => rs.isDefault);
            if (defaultSet) setSelectedRuleSetId(defaultSet.id);
          }
        }
      })
      .catch(() => setRuleSets([]));
  }, [isConnected, setRuleSets, setSelectedRuleSetId]);

  useEffect(() => {
    if (!isConnected || !inboxStateLoadedRef.current) return;
    saveInboxState({ selectedRuleSetId: selectedRuleSetId ?? null }).catch(() => {});
  }, [isConnected, selectedRuleSetId]);

  const loadCandidates = useCallback(async () => {
    if (!isConnected) return;
    setIsLoadingCandidates(true);
    try {
      const inboxResponse = await getInbox({
        limit: 100,
        selectedRuleSetId: selectedRuleSetId ?? undefined,
      });
      const response = inboxResponseToCallQueueResponse(inboxResponse);
      setRawCandidates(response.items);
      setCandidates(response.items.map(mapCallQueueItemToCandidate));
    } catch {
      setRawCandidates([]);
      setCandidates([]);
    } finally {
      setIsLoadingCandidates(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, selectedRuleSetId, routeContext?.date, setRawCandidates]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Self-fetch route stops (detached windows where no bridge exists).
  // Re-fetches when routeDataVersion increments (ROUTE_DATA_CHANGED signal from main window).
  const routeDataVersion = state.routeDataVersion ?? 0;
  useEffect(() => {
    if (!isConnected || !routeContext?.date) return;
    if (state.routeStops.length > 0 && routeDataVersion === 0) return;
    let cancelled = false;
    routeService
      .getRoute({ date: routeContext.date })
      .then((res) => {
        if (!cancelled) {
          setSelfFetchedStops((res as { route: unknown; stops: SavedRouteStop[] }).stops ?? []);
        }
      })
      .catch(() => { if (!cancelled) setSelfFetchedStops([]); });
    return () => { cancelled = true; };
  }, [isConnected, routeContext?.date, state.routeStops.length, routeDataVersion]);

  const remoteInRouteIds = state.remoteInRouteIds;
  const remoteScheduledIds = state.remoteScheduledIds;

  const inRouteIds = useMemo(() => {
    if (remoteInRouteIds) return new Set<string>(remoteInRouteIds);
    return new Set<string>(routeStops.map((s) => s.customerId).filter((id): id is string => id !== null));
  }, [routeStops, remoteInRouteIds]);

  const scheduledIds = useMemo(() => {
    // When a SCHEDULE_SNAPSHOT has been received (remoteScheduledIds is defined),
    // use it as the sole source of truth — even if the array is empty.
    if (remoteScheduledIds !== undefined) {
      return new Set<string>(remoteScheduledIds);
    }
    const matching = routeStops.filter((s) =>
      s.customerId !== null &&
      (s.scheduledTimeStart !== null ||
       s.revisionStatus === 'scheduled' ||
       s.revisionStatus === 'confirmed'));
    return new Set<string>(matching.map((s) => s.customerId as string));
  }, [routeStops, remoteScheduledIds]);

  // Persist filter expression to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY_FILTERS, JSON.stringify(filters)); } catch { /* noop */ }
  }, [filters]);

  // Apply client-side filters + sorting, then enrich with route stop info
  const filteredSorted = useMemo(() => {
    const filtered = applyInboxFilters(rawCandidates, filters, inRouteIds) as CallQueueItem[];

    // Keep selected candidate visible even if filtered out
    const selectedId = state.selectedCustomerId;
    if (selectedId && !filtered.some((c) => c.customerId === selectedId)) {
      const selected = rawCandidates.find((c) => c.customerId === selectedId);
      if (selected) filtered.push(selected);
    }

    const mapped = filtered.map((item) => {
      const candidate = mapCallQueueItemToCandidate(item);
      candidate.isInRoute = inRouteIds.has(candidate.id);
      candidate.isScheduled = candidate.isScheduled || scheduledIds.has(candidate.id);
      return candidate;
    });
    return sortCandidates(mapped);
  }, [rawCandidates, filters, inRouteIds, scheduledIds, state.selectedCustomerId]);

  const handlePresetChange = useCallback((presetId: FilterPresetId) => {
    setFilters((prev) => applyFilterPreset(presetId, prev));
    setActivePresetId(presetId);
  }, []);

  const handleFiltersChange = useCallback((next: InboxFilterExpression) => {
    setFilters(next);
    setActivePresetId(null);
  }, []);

  const resolvedCandidates = candidatesProp ?? filteredSorted;
  const resolvedIsLoading = isLoadingProp ?? isLoadingCandidates;

  return (
    <>
      <InboxFilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        activePresetId={activePresetId}
        onPresetChange={handlePresetChange}
        selectedRuleSetId={selectedRuleSetId}
        onRuleSetChange={setSelectedRuleSetId}
        ruleSets={ruleSets}
        isLoadingRuleSets={false}
        candidateCount={filteredSorted.length}
      />
      <VirtualizedInboxList
        candidates={resolvedCandidates}
        selectedCandidateId={state.selectedCustomerId}
        onCandidateSelect={(id) => actions.selectCustomer(id)}
        isLoading={resolvedIsLoading}
        inRouteIds={inRouteIds}
        scheduledIds={scheduledIds}
        selectable={selectable}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
      />
    </>
  );
}
