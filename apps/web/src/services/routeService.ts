/**
 * Route persistence service
 * 
 * Handles saving and loading planned routes from the backend
 */

import { useNatsStore } from '../stores/natsStore';
import type { PlannedRouteStop } from '@sazinka/shared-types';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface SaveRouteStop {
  customerId: string;
  revisionId?: string;
  order: number;
  eta?: string;
  etd?: string;
}

export interface SaveRouteRequest {
  date: string;
  stops: SaveRouteStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  optimizationScore: number;
}

export interface SaveRouteResponse {
  routeId: string;
  saved: boolean;
  stopsCount: number;
}

export interface SavedRoute {
  id: string;
  userId: string;
  date: string;
  status: string;
  totalDistanceKm: number | null;
  totalDurationMinutes: number | null;
  optimizationScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedRouteStop {
  id: string;
  routeId: string;
  revisionId: string;
  stopOrder: number;
  estimatedArrival: string | null;
  estimatedDeparture: string | null;
  distanceFromPreviousKm: number | null;
  durationFromPreviousMinutes: number | null;
  status: string;
  customerId: string;
  customerName: string;
  address: string;
  customerLat: number | null;
  customerLng: number | null;
}

export interface GetRouteResponse {
  route: SavedRoute | null;
  stops: SavedRouteStop[];
}

/**
 * Convert PlannedRouteStop to SaveRouteStop format
 */
export function toSaveRouteStop(stop: PlannedRouteStop, revisionId?: string): SaveRouteStop {
  return {
    customerId: stop.customerId,
    revisionId,
    order: stop.order,
    eta: stop.eta,
    etd: stop.etd,
  };
}

/**
 * Convert SavedRouteStop to PlannedRouteStop format for display
 */
export function toPlannedRouteStop(stop: SavedRouteStop): PlannedRouteStop {
  return {
    customerId: stop.customerId,
    customerName: stop.customerName,
    address: stop.address,
    coordinates: {
      lat: stop.customerLat ?? 0,
      lng: stop.customerLng ?? 0,
    },
    order: stop.stopOrder,
    eta: stop.estimatedArrival ?? '08:00',
    etd: stop.estimatedDeparture ?? '08:30',
    serviceDurationMinutes: 30,
    timeWindow: undefined,
  };
}

/**
 * Save a route to the backend
 */
export async function saveRoute(
  request: SaveRouteRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<SaveRouteResponse> {
  const response = await deps.request<SaveRouteResponse>('sazinka.route.save', {
    userId: TEMP_USER_ID,
    payload: request,
  });

  return response;
}

/**
 * Get a saved route for a specific date
 */
export async function getRoute(
  date: string,
  deps = { request: useNatsStore.getState().request }
): Promise<GetRouteResponse> {
  const response = await deps.request<GetRouteResponse>('sazinka.route.get', {
    userId: TEMP_USER_ID,
    payload: { date },
  });

  return response;
}

/**
 * Check if a saved route exists for a date
 */
export async function hasRouteForDate(
  date: string,
  deps = { request: useNatsStore.getState().request }
): Promise<boolean> {
  const response = await getRoute(date, deps);
  return response.route !== null;
}
