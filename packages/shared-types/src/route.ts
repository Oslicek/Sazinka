// Route types

import { TimeWindow } from './revision';

export interface Route {
  id: string;
  userId: string;
  date: string;
  status: RouteStatus;
  totalDistanceKm?: number;
  totalDurationMinutes?: number;
  optimizationScore?: number;
  createdAt: string;
  updatedAt: string;
}

export type RouteStatus =
  | 'draft'
  | 'optimized'
  | 'confirmed'
  | 'in_progress'
  | 'completed';

export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  draft: 'Koncept',
  optimized: 'Optimalizováno',
  confirmed: 'Potvrzeno',
  in_progress: 'Probíhá',
  completed: 'Dokončeno',
};

export interface RouteStop {
  order: number;
  revisionId: string;
  customerId: string;
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
  /** Optimization score (0-100) */
  optimizationScore: number;
  /** Warnings about the route */
  warnings: RouteWarning[];
  /** Customer IDs that couldn't be scheduled */
  unassigned: string[];
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
}
