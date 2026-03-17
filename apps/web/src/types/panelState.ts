import type { RouteContext, RouteMetrics, MapInsertionPreview } from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';
import type { RouteWarning } from '@shared/route';

export type { RouteContext, RouteMetrics, MapInsertionPreview, SavedRouteStop, RouteWarning };

export interface ReturnToDepotLeg {
  distanceKm: number;
  durationMinutes: number;
}

export interface PanelState {
  /** Selected customer (candidate in Inbox, stop in Plan) */
  selectedCustomerId: string | null;
  /** Selected route (Plan page) */
  selectedRouteId: string | null;
  /** Date, crew, depot context */
  routeContext: RouteContext | null;
  /** Ordered list of stops on the current route */
  routeStops: SavedRouteStop[];
  /** Index of the highlighted route segment (bidirectional map ↔ timeline) */
  highlightedSegment: number | null;
  /** Candidate insertion preview rendered on the map */
  insertionPreview: MapInsertionPreview | null;
  /** Which page is using this provider */
  activePageContext: 'inbox' | 'plan';
  /** Decoded route polyline [[lng, lat], ...] */
  routeGeometry: [number, number][];
  /** Return-to-depot leg metrics */
  returnToDepotLeg: ReturnToDepotLeg | null;
  /** Depot departure time HH:MM */
  depotDeparture: string | null;
  /** Per-stop route warnings from optimizer/recalculator */
  routeWarnings: RouteWarning[];
  /** Human-readable break constraint warnings */
  breakWarnings: string[];
  /** Aggregated route metrics */
  metrics: RouteMetrics | null;
  /** Arrival buffer as percentage (0–100) */
  routeBufferPercent: number;
  /** Arrival buffer as fixed minutes */
  routeBufferFixedMinutes: number;
  /** Incremented when route data changes remotely (triggers re-fetch in detached panels) */
  routeDataVersion?: number;
  /** In-route customer IDs received via ROUTE_DATA_CHANGED signal (detached panels) */
  remoteInRouteIds?: string[];
  /** Scheduled customer IDs received via ROUTE_DATA_CHANGED signal (detached panels) */
  remoteScheduledIds?: string[];
}

export interface PanelActions {
  selectCustomer(id: string | null): void;
  selectRoute(id: string | null): void;
  setRouteContext(ctx: RouteContext | null): void;
  setRouteStops(stops: SavedRouteStop[]): void;
  /** Broadcast the authoritative scheduled-customer set to all detached panels. */
  sendScheduleSnapshot(scheduledCustomerIds: string[]): void;
  highlightSegment(idx: number | null): void;
  setInsertionPreview(preview: MapInsertionPreview | null): void;
  setRouteGeometry(geo: [number, number][]): void;
  setReturnToDepotLeg(leg: ReturnToDepotLeg | null): void;
  setDepotDeparture(dep: string | null): void;
  setRouteWarnings(warnings: RouteWarning[]): void;
  setBreakWarnings(warnings: string[]): void;
  setMetrics(metrics: RouteMetrics | null): void;
  setRouteBuffer(percent: number, fixedMinutes: number): void;
}

export interface PanelStateContextValue {
  state: PanelState;
  actions: PanelActions;
}
