/**
 * Insertion calculation service
 * Handles route-aware insertion cost calculations using 1×K + K×1 matrix strategy
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

// Types for insertion calculation
export interface RouteStop {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  arrivalTime?: string;
  departureTime?: string;
}

export interface InsertionCandidate {
  id: string;
  customerId: string;
  coordinates: { lat: number; lng: number };
  serviceDurationMinutes: number;
}

export interface CalculateInsertionRequest {
  /** Current route stops (in order) */
  routeStops: RouteStop[];
  /** Depot/start location */
  depot: { lat: number; lng: number };
  /** Candidate to insert */
  candidate: InsertionCandidate;
  /** Date for the calculation */
  date: string;
  /** Working day start time (HH:MM) */
  workdayStart?: string;
  /** Working day end time (HH:MM) */
  workdayEnd?: string;
}

export interface InsertionPosition {
  /** Insert after this index (-1 = after depot/start) */
  insertAfterIndex: number;
  /** Name of stop before insertion point */
  insertAfterName: string;
  /** Name of stop after insertion point */
  insertBeforeName: string;
  /** Additional travel distance in km */
  deltaKm: number;
  /** Additional travel time in minutes */
  deltaMin: number;
  /** Estimated arrival time */
  estimatedArrival: string;
  /** Estimated departure time */
  estimatedDeparture: string;
  /** Status of this insertion */
  status: 'ok' | 'tight' | 'conflict';
  /** Reason if conflict */
  conflictReason?: string;
}

export interface CalculateInsertionResponse {
  candidateId: string;
  /** Best insertion position */
  bestPosition: InsertionPosition | null;
  /** All valid positions sorted by score */
  allPositions: InsertionPosition[];
  /** Overall feasibility */
  isFeasible: boolean;
  /** Reason if not feasible */
  infeasibleReason?: string;
}

export interface CalculateBatchInsertionRequest {
  /** Current route stops (in order) */
  routeStops: RouteStop[];
  /** Depot/start location */
  depot: { lat: number; lng: number };
  /** Candidates to calculate */
  candidates: InsertionCandidate[];
  /** Date for the calculation */
  date: string;
  /** Working day start time (HH:MM) */
  workdayStart?: string;
  /** Working day end time (HH:MM) */
  workdayEnd?: string;
  /** Only calculate best position (faster) */
  bestOnly?: boolean;
}

export interface BatchInsertionResult {
  candidateId: string;
  bestDeltaKm: number;
  bestDeltaMin: number;
  bestInsertAfterIndex: number;
  status: 'ok' | 'tight' | 'conflict';
  isFeasible: boolean;
}

export interface CalculateBatchInsertionResponse {
  results: BatchInsertionResult[];
  /** Processing time in ms */
  processingTimeMs: number;
}

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

/**
 * Calculate best insertion position for a single candidate
 * Returns all possible positions with costs
 */
export async function calculateInsertion(
  request: CalculateInsertionRequest
): Promise<CalculateInsertionResponse> {
  const { request: natsRequest } = useNatsStore.getState();
  
  const response = await natsRequest<CalculateInsertionRequest, NatsResponse<CalculateInsertionResponse>>(
    'sazinka.route.insertion.calculate',
    request
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

/**
 * Calculate best insertion for multiple candidates (batch)
 * Uses 1×K + K×1 matrix strategy for efficiency
 */
export async function calculateBatchInsertion(
  request: CalculateBatchInsertionRequest
): Promise<CalculateBatchInsertionResponse> {
  const { request: natsRequest } = useNatsStore.getState();
  
  const response = await natsRequest<CalculateBatchInsertionRequest, NatsResponse<CalculateBatchInsertionResponse>>(
    'sazinka.route.insertion.batch',
    request
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

/**
 * Format insertion delta for display
 */
export function formatInsertionDelta(deltaMin: number, deltaKm: number): string {
  const minSign = deltaMin >= 0 ? '+' : '';
  const kmSign = deltaKm >= 0 ? '+' : '';
  return `${minSign}${Math.round(deltaMin)}min / ${kmSign}${deltaKm.toFixed(1)}km`;
}

/**
 * Get status icon for insertion status
 */
export function getInsertionStatusIcon(status: 'ok' | 'tight' | 'conflict'): string {
  switch (status) {
    case 'ok': return '✅';
    case 'tight': return '⚠️';
    case 'conflict': return '❌';
  }
}

/**
 * Sort batch results by best insertion cost
 */
export function sortByInsertionCost(results: BatchInsertionResult[]): BatchInsertionResult[] {
  return [...results].sort((a, b) => {
    // Feasible first
    if (a.isFeasible !== b.isFeasible) return a.isFeasible ? -1 : 1;
    // Then by status (ok > tight > conflict)
    const statusOrder = { ok: 0, tight: 1, conflict: 2 };
    if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
    // Then by delta time
    return a.bestDeltaMin - b.bestDeltaMin;
  });
}
