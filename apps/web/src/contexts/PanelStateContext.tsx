import { createContext, useState, useCallback, useMemo } from 'react';
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
} from '../types/panelState';
import { usePanelChannel } from '../hooks/usePanelChannel';

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
}

export function PanelStateProvider({
  children,
  activePageContext = 'inbox',
  enableChannel = false,
}: PanelStateProviderProps) {
  const [state, setState] = useState<PanelState>({
    ...DEFAULT_STATE,
    activePageContext,
  });

  const applyPartial = useCallback((partial: Partial<PanelState>) => {
    setState(s => ({ ...s, ...partial }));
  }, []);

  usePanelChannel(enableChannel, state, applyPartial);

  const selectCustomer = useCallback((id: string | null) => {
    setState(s => ({ ...s, selectedCustomerId: id }));
  }, []);

  const selectRoute = useCallback((id: string | null) => {
    setState(s => ({ ...s, selectedRouteId: id }));
  }, []);

  const setRouteContext = useCallback((ctx: RouteContext | null) => {
    setState(s => ({ ...s, routeContext: ctx }));
  }, []);

  const setRouteStops = useCallback((stops: SavedRouteStop[]) => {
    setState(s => ({ ...s, routeStops: stops }));
  }, []);

  const highlightSegment = useCallback((idx: number | null) => {
    setState(s => ({ ...s, highlightedSegment: idx }));
  }, []);

  const setInsertionPreview = useCallback((preview: MapInsertionPreview | null) => {
    setState(s => ({ ...s, insertionPreview: preview }));
  }, []);

  const setRouteGeometry = useCallback((geo: [number, number][]) => {
    setState(s => ({ ...s, routeGeometry: geo }));
  }, []);

  const setReturnToDepotLeg = useCallback((leg: ReturnToDepotLeg | null) => {
    setState(s => ({ ...s, returnToDepotLeg: leg }));
  }, []);

  const setDepotDeparture = useCallback((dep: string | null) => {
    setState(s => ({ ...s, depotDeparture: dep }));
  }, []);

  const setRouteWarnings = useCallback((warnings: RouteWarning[]) => {
    setState(s => ({ ...s, routeWarnings: warnings }));
  }, []);

  const setBreakWarnings = useCallback((warnings: string[]) => {
    setState(s => ({ ...s, breakWarnings: warnings }));
  }, []);

  const setMetrics = useCallback((metrics: RouteMetrics | null) => {
    setState(s => ({ ...s, metrics: metrics }));
  }, []);

  const setRouteBuffer = useCallback((percent: number, fixedMinutes: number) => {
    setState(s => ({ ...s, routeBufferPercent: percent, routeBufferFixedMinutes: fixedMinutes }));
  }, []);

  const actions: PanelActions = useMemo(() => ({
    selectCustomer,
    selectRoute,
    setRouteContext,
    setRouteStops,
    highlightSegment,
    setInsertionPreview,
    setRouteGeometry,
    setReturnToDepotLeg,
    setDepotDeparture,
    setRouteWarnings,
    setBreakWarnings,
    setMetrics,
    setRouteBuffer,
  }), [
    selectCustomer, selectRoute, setRouteContext, setRouteStops, highlightSegment,
    setInsertionPreview, setRouteGeometry, setReturnToDepotLeg, setDepotDeparture,
    setRouteWarnings, setBreakWarnings, setMetrics, setRouteBuffer,
  ]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return (
    <PanelStateContext.Provider value={value}>
      {children}
    </PanelStateContext.Provider>
  );
}
