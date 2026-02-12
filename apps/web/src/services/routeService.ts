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
  customerId?: string;
  revisionId?: string;
  order: number;
  eta?: string;
  etd?: string;
  distanceFromPreviousKm?: number;
  durationFromPreviousMinutes?: number;
  stopType?: 'customer' | 'break';
  breakDurationMinutes?: number;
  breakTimeStart?: string;
  /** Optional status override (e.g. "unassigned"). Defaults to "pending" on backend. */
  status?: string;
  /** Per-stop service duration in minutes. If omitted, global default is used. */
  serviceDurationMinutes?: number;
}

export interface SaveRouteRequest {
  date: string;
  crewId?: string | null;
  depotId?: string | null;
  stops: SaveRouteStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  optimizationScore: number;
  returnToDepotDistanceKm?: number | null;
  returnToDepotDurationMinutes?: number | null;
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
  depotId: string | null;
  date: string;
  status: string;
  totalDistanceKm: number | null;
  totalDurationMinutes: number | null;
  optimizationScore: number | null;
  returnToDepotDistanceKm: number | null;
  returnToDepotDurationMinutes: number | null;
  stopsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedRouteStop {
  id: string;
  routeId: string;
  revisionId: string | null;
  stopOrder: number;
  estimatedArrival: string | null;
  estimatedDeparture: string | null;
  distanceFromPreviousKm: number | null;
  durationFromPreviousMinutes: number | null;
  status: string;
  stopType: 'customer' | 'break';
  customerId: string | null;
  customerName: string | null;
  address: string | null;
  customerLat: number | null;
  customerLng: number | null;
  customerPhone: string | null;
  customerEmail: string | null;
  scheduledDate: string | null;
  scheduledTimeStart: string | null;
  scheduledTimeEnd: string | null;
  revisionStatus: string | null;
  // Break stop fields (only for stopType === 'break')
  breakDurationMinutes?: number | null;
  breakTimeStart?: string | null; // HH:MM format
  /** Per-stop service duration in minutes */
  serviceDurationMinutes?: number | null;
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
    stopType: 'customer',
  };
}

/**
 * Convert SavedRouteStop to PlannedRouteStop format for display
 */
export function toPlannedRouteStop(stop: SavedRouteStop): PlannedRouteStop {
  return {
    customerId: stop.customerId ?? '',
    customerName: stop.customerName ?? (stop.stopType === 'break' ? 'Pauza' : ''),
    address: stop.address ?? '',
    coordinates: {
      lat: stop.customerLat ?? 0,
      lng: stop.customerLng ?? 0,
    },
    order: stop.stopOrder,
    eta: stop.estimatedArrival ?? '08:00',
    etd: stop.estimatedDeparture ?? '08:30',
    serviceDurationMinutes: stop.serviceDurationMinutes ?? 30,
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
 * Get a saved route by route ID or by date.
 * When routeId is provided, it takes precedence over date.
 */
export async function getRoute(
  params: { routeId: string } | { date: string },
  deps = { request: useNatsStore.getState().request }
): Promise<GetRouteResponse> {
  const payload = 'routeId' in params
    ? { routeId: params.routeId }
    : { date: params.date };
  const req = createRequest(getToken(), payload);
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
 * Delete a route by ID
 */
export async function deleteRoute(
  routeId: string,
  deps = { request: useNatsStore.getState().request }
): Promise<{ deleted: boolean }> {
  const req = createRequest(getToken(), { routeId });
  const response = await deps.request<typeof req, NatsResponse<{ deleted: boolean }>>(
    'sazinka.route.delete',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update a route (e.g. assign crew)
 */
export async function updateRoute(
  routeId: string,
  updates: { crewId?: string | null; depotId?: string | null; status?: string },
  deps = { request: useNatsStore.getState().request }
): Promise<{ updated: boolean }> {
  const req = createRequest(getToken(), { routeId, ...updates });
  const response = await deps.request<typeof req, NatsResponse<{ updated: boolean }>>(
    'sazinka.route.update',
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
  const response = await getRoute({ date }, deps);
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

/** Request to list routes with filters */
export interface ListRoutesRequest {
  dateFrom: string;
  dateTo: string;
  crewId?: string | null;
  depotId?: string | null;
}

export interface ListRoutesResponse {
  routes: SavedRoute[];
}

/**
 * List routes with optional filters (date range, crew, depot)
 */
export async function listRoutes(
  filters: ListRoutesRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<ListRoutesResponse> {
  const req = createRequest(getToken(), filters);
  const response = await deps.request<typeof req, NatsResponse<ListRoutesResponse>>(
    'sazinka.route.list',
    req,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ==========================================================================
// Quick route recalculation (ETA/ETD after insert or reorder)
// ==========================================================================

/** A stop sent in the recalculation request */
export interface RecalcStopInput {
  coordinates: { lat: number; lng: number };
  stopType: string; // 'customer' | 'break'
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
  serviceDurationMinutes?: number | null;
  breakDurationMinutes?: number | null;
  /** Passthrough fields returned unchanged */
  id?: string;
  customerId?: string;
  customerName?: string;
}

/** Request payload for route.recalculate */
export interface RecalculateRouteRequest {
  depot: { lat: number; lng: number };
  stops: RecalcStopInput[];
  workdayStart?: string;
  workdayEnd?: string;
  defaultServiceDurationMinutes?: number;
}

/** A single recalculated stop returned from backend */
export interface RecalcStopResult {
  order: number;
  estimatedArrival: string;
  estimatedDeparture: string;
  distanceFromPreviousKm: number;
  durationFromPreviousMinutes: number;
  serviceDurationMinutes: number;
  id?: string;
  customerId?: string;
  customerName?: string;
}

/** Response from route.recalculate */
export interface RecalculateRouteResponse {
  stops: RecalcStopResult[];
  returnToDepotDistanceKm: number;
  returnToDepotDurationMinutes: number;
  totalDistanceKm: number;
  totalTravelMinutes: number;
  totalServiceMinutes: number;
}

/**
 * Quick recalculation of ETAs/ETDs for an ordered route.
 * Uses Valhalla matrix + sequential_schedule on backend.
 */
export async function recalculateRoute(
  data: RecalculateRouteRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<RecalculateRouteResponse> {
  const req = createRequest(getToken(), data);
  const response = await deps.request<typeof req, NatsResponse<RecalculateRouteResponse>>(
    'sazinka.route.recalculate',
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

/** Time window for a specific customer, passed from the saved route stops */
export interface CustomerTimeWindow {
  customerId: string;
  /** Scheduled time start, e.g. "14:00" */
  start: string;
  /** Scheduled time end, e.g. "15:00" */
  end: string;
}

/** Request to submit a route planning job */
export interface RoutePlanJobRequest {
  customerIds: string[];
  date: string;  // YYYY-MM-DD format
  startLocation: Coordinates;
  /** Optional crew ID - if provided, crew-specific settings (arrival buffer) are used */
  crewId?: string;
  /** Time windows from the saved route stops. Takes priority over DB lookup. */
  timeWindows?: CustomerTimeWindow[];
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
    ...(request.crewId ? { crewId: request.crewId } : {}),
    ...(request.timeWindows && request.timeWindows.length > 0 ? { timeWindows: request.timeWindows } : {}),
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
