export interface SelectedCandidateForMap {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
}

export type PanelSignal =
  | { type: 'SELECT_CUSTOMER'; customerId: string | null }
  | { type: 'SELECT_CANDIDATE_MAP'; candidate: SelectedCandidateForMap | null }
  | { type: 'SELECT_CANDIDATES_MAP'; candidates: SelectedCandidateForMap[] }
  | { type: 'HIGHLIGHT_SEGMENT'; segmentIndex: number | null }
  | { type: 'ROUTE_CONTEXT'; date: string; crewId: string; depotId: string }
  | { type: 'SELECT_ROUTE'; routeId: string | null }
  | { type: 'REQUEST_CONTEXT_SNAPSHOT' }
  | {
      type: 'CONTEXT_SNAPSHOT';
      routeContext: { date: string; crewId: string; depotId: string } | null;
      selectedCustomerId: string | null;
      selectedRouteId: string | null;
      highlightedSegment: number | null;
      inRouteCustomerIds?: string[];
      scheduledCustomerIds?: string[];
      selectedCandidateForMap?: SelectedCandidateForMap | null;
      selectedCandidatesForMap?: SelectedCandidateForMap[];
      mapSelectionTool?: 'click' | 'rect' | null;
      mapSelectedIds?: string[];
    }
  | { type: 'ROUTE_DATA_CHANGED'; inRouteCustomerIds: string[] }
  | { type: 'SCHEDULE_SNAPSHOT'; scheduledCustomerIds: string[] }
  | { type: 'PANEL_DETACHED'; panel: 'map' | 'list'; page: 'inbox' | 'plan' }
  | { type: 'PANEL_REATTACHED'; panel: 'map' | 'list'; page: 'inbox' | 'plan' }
  | { type: 'MAP_SELECTION_TOOL'; tool: 'click' | 'rect' | null }
  | { type: 'MAP_SUB_SELECT'; candidateIds: string[] }
  | { type: 'MAP_SUB_DESELECT'; candidateIds: string[] }
  | { type: 'MAP_SUB_SELECT_TOGGLE'; candidateId: string }
  | { type: 'MAP_SUB_SELECTION_SYNC'; mapSelectedIds: string[] };

export interface PanelSignalEnvelope {
  senderId: string;
  signal: PanelSignal;
}
