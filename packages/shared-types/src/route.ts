// Route types

import { TimeWindow } from './revision';

export interface Route {
  id: string;
  userId: string;
  crewId?: string | null;
  date: string;
  status: RouteStatus;
  totalDistanceKm?: number;
  totalDurationMinutes?: number;
  optimizationScore?: number;
  arrivalBufferPercent: number;
  arrivalBufferFixedMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export type RouteStatus =
  | 'draft'
  | 'optimized'
  | 'confirmed'
  | 'in_progress'
  | 'completed';

/** i18n translation keys for route statuses */
export const ROUTE_STATUS_KEYS: Record<RouteStatus, string> = {
  draft: 'common:route_status.draft',
  optimized: 'common:route_status.optimized',
  confirmed: 'common:route_status.confirmed',
  in_progress: 'common:route_status.in_progress',
  completed: 'common:route_status.completed',
};

export interface RouteStop {
  order: number;
  customerId: string;
  visitId?: string | null;
  revisionId?: string | null;
  customerName: string;
  address: string;
  lat: number;
  lng: number;
  estimatedArrival: string;
  estimatedDeparture: string;
  timeWindow?: TimeWindow;
  distanceFromPreviousKm?: number;
  durationFromPreviousMinutes?: number;
  serviceDurationMinutes: number;
  overrideServiceDurationMinutes?: number | null;
  overrideTravelDurationMinutes?: number | null;
  status: StopStatus;
  actualArrival?: string;
  actualDeparture?: string;
}

export type StopStatus = 'pending' | 'arrived' | 'completed' | 'skipped';

export interface OptimizeRouteRequest {
  date: string;
  revisionIds: string[];
}

export interface OptimizeRouteResult {
  stops: RouteStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  optimizationScore: number;
  warnings: RouteWarning[];
}

export interface RouteWarning {
  stopIndex?: number;
  warningType: string;
  message: string;
}

// Route planning types

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface WorkingHours {
  start: string; // HH:MM format
  end: string;   // HH:MM format
}

export interface RoutePlanRequest {
  /** Starting location (technician's home/office) */
  startLocation: Coordinates;
  /** Customer IDs to visit */
  customerIds: string[];
  /** Date for the route (YYYY-MM-DD) */
  date: string;
  /** Working hours (optional, defaults to 08:00-17:00) */
  workingHours?: WorkingHours;
}

export interface RoutePlanResponse {
  /** Planned stops in optimal order */
  stops: PlannedRouteStop[];
  /** Total distance in kilometers */
  totalDistanceKm: number;
  /** Total duration in minutes */
  totalDurationMinutes: number;
  /** Algorithm used for optimization */
  algorithm: string;
  /** Solver runtime in milliseconds */
  solveTimeMs: number;
  /** Solver log lines */
  solverLog: string[];
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Warnings about the route */
  warnings: RouteWarning[];
  /** Customer IDs that couldn't be scheduled */
  unassigned: string[];
  /** Route geometry as GeoJSON coordinates [[lng, lat], ...] */
  geometry?: [number, number][];
  /** Return leg distance from last stop back to depot (km) */
  returnToDepotDistanceKm?: number;
  /** Return leg duration from last stop back to depot (minutes) */
  returnToDepotDurationMinutes?: number;
}

export interface PlannedRouteStop {
  /** Customer ID */
  customerId: string;
  /** Customer name */
  customerName: string;
  /** Address */
  address: string;
  /** Coordinates */
  coordinates: Coordinates;
  /** Order in route (1-based) */
  order: number;
  /** Estimated time of arrival (HH:MM) */
  eta: string;
  /** Estimated time of departure (HH:MM) */
  etd: string;
  /** Service duration in minutes */
  serviceDurationMinutes: number;
  /** Time window constraint (if any) */
  timeWindow?: TimeWindow;
  /** Stop type (customer or break) */
  stopType?: 'customer' | 'break';
  /** Break duration in minutes (for break stops) */
  breakDurationMinutes?: number;
  /** Break start time (for break stops) */
  breakTimeStart?: string;
  /** Distance from previous location in km (Valhalla matrix based) */
  distanceFromPreviousKm?: number;
  /** Duration from previous location in minutes (Valhalla matrix based) */
  durationFromPreviousMinutes?: number;
  /** Manual override for service duration (replaces calculated/agreed value) */
  overrideServiceDurationMinutes?: number | null;
  /** Manual override for travel duration from previous stop (replaces matrix value) */
  overrideTravelDurationMinutes?: number | null;
}
