import { createContext, useState, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type {
  PanelState,
  PanelActions,
  PanelStateContextValue,
  RouteContext,
  SavedRouteStop,
  MapInsertionPreview,
  ReturnToDepotLeg,
  RouteWarning,
  RouteMetrics,
  SelectedCandidateForMap,
} from '../types/panelState';
import { usePanelSignals } from '../hooks/usePanelSignals';
import type { PanelSignal } from '../types/panelSignals';

export const PanelStateContext = createContext<PanelStateContextValue | null>(null);

const DEFAULT_STATE: PanelState = {
  selectedCustomerId: null,
  selectedRouteId: null,
  routeContext: null,
  routeStops: [],
  highlightedSegment: null,
  insertionPreview: null,
  activePageContext: 'inbox',
  routeGeometry: [],
  returnToDepotLeg: null,
  depotDeparture: null,
  routeWarnings: [],
  breakWarnings: [],
  metrics: null,
  routeBufferPercent: 0,
  routeBufferFixedMinutes: 0,
};

interface PanelStateProviderProps {
  children: ReactNode;
  activePageContext?: 'inbox' | 'plan';
  enableChannel?: boolean;
  /** Main window sets this true — it responds to REQUEST_CONTEXT_SNAPSHOT */
  isSourceOfTruth?: boolean;
  /** Detached windows pass the URL-seeded context here for immediate load */
  initialRouteContext?: RouteContext | null;
  /** Override channel name — defaults to sazinka-panels-{activePageContext} */
  channelName?: string;
}

export function PanelStateProvider({
  children,
  activePageContext = 'inbox',
  enableChannel = false,
  isSourceOfTruth = false,
  initialRouteContext,
  channelName,
}: PanelStateProviderProps) {
  const resolvedChannelName = channelName ?? `sazinka-panels-${activePageContext}`;
  const [state, setState] = useState<PanelState>(() => ({
    ...DEFAULT_STATE,
    activePageContext,
    routeContext: initialRouteContext ?? null,
  }));

  // Keep a ref so getSnapshot always reads current state without stale closure
  const stateRef = useRef(state);
  stateRef.current = state;

  const onSignal = useCallback((signal: PanelSignal) => {
    switch (signal.type) {
      case 'SELECT_CUSTOMER':
        setState(s => s.selectedCustomerId === signal.customerId ? s : { ...s, selectedCustomerId: signal.customerId });
        break;
      case 'SELECT_CANDIDATE_MAP':
        setState(s => ({ ...s, selectedCandidateForMap: signal.candidate }));
        break;
      case 'SELECT_CANDIDATES_MAP':
        setState(s => ({ ...s, selectedCandidatesForMap: signal.candidates }));
        break;
      case 'MAP_DEPOT':
        setState(s => ({ ...s, mapDepot: signal.depot }));
        break;
      case 'MAP_SELECTION_TOOL':
        setState(s => ({ ...s, mapSelectionTool: signal.tool }));
        break;
      case 'MAP_SUB_SELECTION_SYNC':
        setState(s => ({ ...s, mapSelectedIds: signal.mapSelectedIds }));
        break;
      case 'MAP_SUB_SELECT': {
        const addIds = new Set(signal.candidateIds);
        setState(s => {
          const next = [...new Set([...(s.mapSelectedIds ?? []), ...addIds])];
          return { ...s, mapSelectedIds: next };
        });
        break;
      }
      case 'MAP_SUB_DESELECT': {
        const removeIds = new Set(signal.candidateIds);
        setState(s => ({
          ...s,
          mapSelectedIds: (s.mapSelectedIds ?? []).filter(id => !removeIds.has(id)),
        }));
        break;
      }
      case 'MAP_SUB_SELECT_TOGGLE': {
        const toggleId = signal.candidateId;
        setState(s => {
          const current = s.mapSelectedIds ?? [];
          const next = current.includes(toggleId)
            ? current.filter(id => id !== toggleId)
            : [...current, toggleId];
          return { ...s, mapSelectedIds: next };
        });
        break;
      }
      case 'SELECT_ROUTE':
        setState(s => s.selectedRouteId === signal.routeId ? s : { ...s, selectedRouteId: signal.routeId });
        break;
      case 'HIGHLIGHT_SEGMENT':
        setState(s => s.highlightedSegment === signal.segmentIndex ? s : { ...s, highlightedSegment: signal.segmentIndex });
        break;
      case 'ROUTE_CONTEXT':
        setState(s => {
          const ctx = s.routeContext;
          if (ctx && ctx.date === signal.date && ctx.crewId === signal.crewId && ctx.depotId === signal.depotId) return s;
          return { ...s, routeContext: { ...signal, crewName: ctx?.crewName ?? '', depotName: ctx?.depotName ?? '' } };
        });
        break;
      case 'CONTEXT_SNAPSHOT':
        setState(s => ({
          ...s,
          selectedCustomerId: signal.selectedCustomerId,
          selectedRouteId: signal.selectedRouteId,
          highlightedSegment: signal.highlightedSegment,
          routeContext: signal.routeContext
            ? { ...signal.routeContext, crewName: s.routeContext?.crewName ?? '', depotName: s.routeContext?.depotName ?? '' }
            : s.routeContext,
          remoteInRouteIds: signal.inRouteCustomerIds ?? s.remoteInRouteIds,
          remoteScheduledIds: signal.scheduledCustomerIds ?? s.remoteScheduledIds,
          selectedCandidateForMap: signal.selectedCandidateForMap ?? s.selectedCandidateForMap,
          selectedCandidatesForMap: signal.selectedCandidatesForMap ?? s.selectedCandidatesForMap,
          mapDepot: signal.mapDepot ?? s.mapDepot,
          mapSelectionTool: signal.mapSelectionTool ?? s.mapSelectionTool,
          mapSelectedIds: signal.mapSelectedIds ?? s.mapSelectedIds,
        }));
        break;
      case 'ROUTE_DATA_CHANGED': {
        setState(s => ({
          ...s,
          routeDataVersion: (s.routeDataVersion ?? 0) + 1,
          remoteInRouteIds: signal.inRouteCustomerIds,
        }));
        break;
      }
      case 'SCHEDULE_SNAPSHOT': {
        setState(s => ({
          ...s,
          remoteScheduledIds: signal.scheduledCustomerIds,
        }));
        break;
      }
      default:
        break;
    }
  }, []);

  const getSnapshot = useCallback(() => {
    const s = stateRef.current;
    const stops = s.routeStops;
    const inRouteCustomerIds = stops
      .map(st => st.customerId)
      .filter((id): id is string => id !== null);
    // Prefer the authoritative snapshot (includes candidates scheduled outside the route)
    // over the route-stop-derived set (which misses inbox-only scheduling)
    const scheduledCustomerIds = s.lastScheduledSnapshot ?? stops
      .filter(st =>
        st.customerId !== null &&
        (st.scheduledTimeStart !== null ||
         st.revisionStatus === 'scheduled' ||
         st.revisionStatus === 'confirmed'))
      .map(st => st.customerId as string);
    return {
      routeContext: s.routeContext
        ? { date: s.routeContext.date, crewId: s.routeContext.crewId, depotId: s.routeContext.depotId }
        : null,
      selectedCustomerId: s.selectedCustomerId,
      selectedRouteId: s.selectedRouteId,
      highlightedSegment: s.highlightedSegment,
      inRouteCustomerIds,
      scheduledCustomerIds,
      selectedCandidateForMap: s.selectedCandidateForMap ?? null,
      selectedCandidatesForMap: s.selectedCandidatesForMap ?? [],
      mapDepot: s.mapDepot ?? null,
      mapSelectionTool: s.mapSelectionTool ?? null,
      mapSelectedIds: s.mapSelectedIds ?? [],
    };
  }, []);

  const { sendSignal } = usePanelSignals({
    enabled: enableChannel,
    isSourceOfTruth,
    onSignal,
    getSnapshot: isSourceOfTruth ? getSnapshot : undefined,
    channelName: resolvedChannelName,
  });

  // Expose sendSignal via context so panels can emit signals
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  const selectCustomer = useCallback((id: string | null) => {
    setState(s => s.selectedCustomerId === id ? s : { ...s, selectedCustomerId: id });
    sendSignalRef.current({ type: 'SELECT_CUSTOMER', customerId: id });
  }, []);

  const selectRoute = useCallback((id: string | null) => {
    setState(s => s.selectedRouteId === id ? s : { ...s, selectedRouteId: id });
    sendSignalRef.current({ type: 'SELECT_ROUTE', routeId: id });
  }, []);

  const setRouteContext = useCallback((ctx: RouteContext | null) => {
    setState(s => s.routeContext === ctx ? s : { ...s, routeContext: ctx });
    if (ctx) {
      sendSignalRef.current({ type: 'ROUTE_CONTEXT', date: ctx.date, crewId: ctx.crewId, depotId: ctx.depotId });
    }
  }, []);

  const setRouteStops = useCallback((stops: SavedRouteStop[]) => {
    setState(s => {
      if (s.routeStops === stops) return s;
      if (isSourceOfTruth && enableChannel) {
        const inRouteCustomerIds = stops
          .map(st => st.customerId)
          .filter((id): id is string => id !== null);
        sendSignalRef.current({ type: 'ROUTE_DATA_CHANGED', inRouteCustomerIds });
      }
      return { ...s, routeStops: stops };
    });
  }, [isSourceOfTruth, enableChannel]);

  const sendScheduleSnapshot = useCallback((scheduledCustomerIds: string[]) => {
    setState(s => ({ ...s, lastScheduledSnapshot: scheduledCustomerIds }));
    if (isSourceOfTruth && enableChannel) {
      sendSignalRef.current({ type: 'SCHEDULE_SNAPSHOT', scheduledCustomerIds });
    }
  }, [isSourceOfTruth, enableChannel]);

  const highlightSegment = useCallback((idx: number | null) => {
    setState(s => s.highlightedSegment === idx ? s : { ...s, highlightedSegment: idx });
    sendSignalRef.current({ type: 'HIGHLIGHT_SEGMENT', segmentIndex: idx });
  }, []);

  const setInsertionPreview = useCallback((preview: MapInsertionPreview | null) => {
    setState(s => s.insertionPreview === preview ? s : { ...s, insertionPreview: preview });
  }, []);

  const setRouteGeometry = useCallback((geo: [number, number][]) => {
    setState(s => s.routeGeometry === geo ? s : { ...s, routeGeometry: geo });
  }, []);

  const setReturnToDepotLeg = useCallback((leg: ReturnToDepotLeg | null) => {
    setState(s => {
      if (leg === null && s.returnToDepotLeg === null) return s;
      if (leg === s.returnToDepotLeg) return s;
      if (leg && s.returnToDepotLeg && leg.distanceKm === s.returnToDepotLeg.distanceKm && leg.durationMinutes === s.returnToDepotLeg.durationMinutes) return s;
      return { ...s, returnToDepotLeg: leg };
    });
  }, []);

  const setDepotDeparture = useCallback((dep: string | null) => {
    setState(s => s.depotDeparture === dep ? s : { ...s, depotDeparture: dep });
  }, []);

  const setRouteWarnings = useCallback((warnings: RouteWarning[]) => {
    setState(s => s.routeWarnings === warnings ? s : { ...s, routeWarnings: warnings });
  }, []);

  const setBreakWarnings = useCallback((warnings: string[]) => {
    setState(s => s.breakWarnings === warnings ? s : { ...s, breakWarnings: warnings });
  }, []);

  const setMetrics = useCallback((metrics: RouteMetrics | null) => {
    setState(s => s.metrics === metrics ? s : { ...s, metrics: metrics });
  }, []);

  const setRouteBuffer = useCallback((percent: number, fixedMinutes: number) => {
    setState(s => s.routeBufferPercent === percent && s.routeBufferFixedMinutes === fixedMinutes ? s : { ...s, routeBufferPercent: percent, routeBufferFixedMinutes: fixedMinutes });
  }, []);

  const setSelectedCandidateForMap = useCallback((candidate: SelectedCandidateForMap | null) => {
    setState(s => ({ ...s, selectedCandidateForMap: candidate }));
    sendSignalRef.current({ type: 'SELECT_CANDIDATE_MAP', candidate });
  }, []);

  const setSelectedCandidatesForMap = useCallback((candidates: SelectedCandidateForMap[]) => {
    setState(s => ({ ...s, selectedCandidatesForMap: candidates }));
    sendSignalRef.current({ type: 'SELECT_CANDIDATES_MAP', candidates });
  }, []);

  const setMapDepot = useCallback((depot: { lat: number; lng: number; name?: string } | null) => {
    setState(s => ({ ...s, mapDepot: depot }));
    sendSignalRef.current({ type: 'MAP_DEPOT', depot });
  }, []);

  const setMapSelectionTool = useCallback((tool: 'click' | 'rect' | null) => {
    setState(s => ({ ...s, mapSelectionTool: tool }));
    sendSignalRef.current({ type: 'MAP_SELECTION_TOOL', tool });
  }, []);

  const setMapSelectedIds = useCallback((ids: string[]) => {
    setState(s => ({ ...s, mapSelectedIds: ids }));
    sendSignalRef.current({ type: 'MAP_SUB_SELECTION_SYNC', mapSelectedIds: ids });
  }, []);

  const actions: PanelActions = useMemo(() => ({
    selectCustomer,
    selectRoute,
    setRouteContext,
    setRouteStops,
    sendScheduleSnapshot,
    highlightSegment,
    setInsertionPreview,
    setRouteGeometry,
    setReturnToDepotLeg,
    setDepotDeparture,
    setRouteWarnings,
    setBreakWarnings,
    setMetrics,
    setRouteBuffer,
    setSelectedCandidateForMap,
    setSelectedCandidatesForMap,
    setMapDepot,
    setMapSelectionTool,
    setMapSelectedIds,
  }), [
    selectCustomer, selectRoute, setRouteContext, setRouteStops, sendScheduleSnapshot, highlightSegment,
    setInsertionPreview, setRouteGeometry, setReturnToDepotLeg, setDepotDeparture,
    setRouteWarnings, setBreakWarnings, setMetrics, setRouteBuffer, setSelectedCandidateForMap,
    setSelectedCandidatesForMap, setMapDepot, setMapSelectionTool, setMapSelectedIds,
  ]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return (
    <PanelStateContext.Provider value={value}>
      {children}
    </PanelStateContext.Provider>
  );
}
