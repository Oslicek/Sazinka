export type PanelSignal =
  | { type: 'SELECT_CUSTOMER'; customerId: string | null }
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
    }
  | { type: 'ROUTE_DATA_CHANGED'; inRouteCustomerIds: string[] }
  | { type: 'SCHEDULE_SNAPSHOT'; scheduledCustomerIds: string[] }
  | { type: 'PANEL_DETACHED'; panel: 'map' | 'list'; page: 'inbox' | 'plan' }
  | { type: 'PANEL_REATTACHED'; panel: 'map' | 'list'; page: 'inbox' | 'plan' };

export interface PanelSignalEnvelope {
  senderId: string;
  signal: PanelSignal;
}
