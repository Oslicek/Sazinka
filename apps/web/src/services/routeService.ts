/**
 * Route persistence service
 * 
 * Handles saving and loading planned routes from the backend
 * Also handles async route planning via JetStream job queue
 */

import { useNatsStore } from '../stores/natsStore';
import { createRequest, type SuccessResponse, type ErrorResponse } from '@shared/messages';
import type { PlannedRouteStop, Coordinates, RoutePlanResponse } from '@shared/route';
import { getToken } from '@/utils/auth';

/**
 * Response type that can be either success or error
 */
type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Type guard to check if response is an error
 */
function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

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
  crewId: string | null;
  crewName?: string;
  date: string;
  status: string;
  totalDistanceKm: number | null;
  totalDurationMinutes: number | null;
  optimizationScore: number | null;
  stopsCount?: number;
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
  data: SaveRouteRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<SaveRouteResponse> {
  const req = createRequest(getToken(), data);
  const response = await deps.request<typeof req, NatsResponse<SaveRouteResponse>>(
    'sazinka.route.save',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get a saved route for a specific date
 */
export async function getRoute(
  date: string,
  deps = { request: useNatsStore.getState().request }
): Promise<GetRouteResponse> {
  const req = createRequest(getToken(), { date });
  const response = await deps.request<typeof req, NatsResponse<GetRouteResponse>>(
    'sazinka.route.get',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
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

export interface ListRoutesForDateResponse {
  routes: SavedRoute[];
}

/**
 * List all routes for a specific date (for all crews)
 */
export async function listRoutesForDate(
  date: string,
  deps = { request: useNatsStore.getState().request }
): Promise<ListRoutesForDateResponse> {
  const req = createRequest(getToken(), { date });
  const response = await deps.request<typeof req, NatsResponse<ListRoutesForDateResponse>>(
    'sazinka.route.list_for_date',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ==========================================================================
// Route Planning Job Queue (async)
// ==========================================================================

/** Request to submit a route planning job */
export interface RoutePlanJobRequest {
  customerIds: string[];
  date: string;  // YYYY-MM-DD format
  startLocation: Coordinates;
}

/** Response from submitting a route planning job */
export interface RoutePlanJobSubmitResponse {
  jobId: string;
  position: number;
  estimatedWaitSeconds: number;
}

/** Route job status types */
export type RouteJobStatus =
  | { type: 'queued'; position: number; estimatedWaitSeconds: number }
  | { type: 'processing'; progress: number; message: string }
  | { type: 'completed'; result: RoutePlanResponse }
  | { type: 'failed'; error: string };

/** Status update message for route job */
export interface RouteJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: RouteJobStatus;
}

/**
 * Submit a route planning job to the async queue
 */
export async function submitRoutePlanJob(
  request: RoutePlanJobRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<RoutePlanJobSubmitResponse> {
  const req = createRequest(getToken(), {
    customerIds: request.customerIds,
    date: request.date,
    startLocation: request.startLocation,
  });
  
  const response = await deps.request<typeof req, NatsResponse<RoutePlanJobSubmitResponse>>(
    'sazinka.route.submit',
    req
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

/**
 * Subscribe to route job status updates
 */
export async function subscribeToRouteJobStatus(
  jobId: string,
  callback: (update: RouteJobStatusUpdate) => void,
  deps = { subscribe: useNatsStore.getState().subscribe }
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('subscribe is not available');
  }
  
  const subject = `sazinka.job.status.${jobId}`;
  return deps.subscribe<RouteJobStatusUpdate>(subject, callback);
}
