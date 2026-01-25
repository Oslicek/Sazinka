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
