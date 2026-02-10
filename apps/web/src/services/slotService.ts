/**
 * Slot suggestion service
 * Handles NATS communication for smart slot suggestions (v1 legacy + v2 multi-crew)
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

// ── V1 types (legacy, kept for backward compatibility) ──

export interface SuggestSlotsRequest {
  date: string; // YYYY-MM-DD
  customerCoordinates: {
    lat: number;
    lng: number;
  };
  serviceDurationMinutes: number;
  preferredTimeStart?: string; // HH:MM
  preferredTimeEnd?: string; // HH:MM
  maxSuggestions?: number;
}

export interface SuggestedSlot {
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
  insertPosition: number;
  score: number;
  deltaTravelMinutes: number;
  reason: string;
}

export interface SuggestSlotsResponse {
  slots: SuggestedSlot[];
  currentRouteMinutes: number;
  existingStops: number;
}

// ── V2 types (multi-crew, Valhalla-backed) ──

export interface SuggestSlotsV2Request {
  date: string; // YYYY-MM-DD
  customerId: string; // UUID — coordinates loaded from DB
  serviceDurationMinutes: number;
  preferredTimeStart?: string; // HH:MM
  preferredTimeEnd?: string; // HH:MM
  crewIds?: string[]; // undefined = all active crews
  maxPerCrew?: number; // default 3
}

export interface CrewSlotSuggestion {
  crewId: string;
  crewName: string;
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
  insertPosition: number;
  score: number; // 0-100
  deltaTravelMinutes: number;
  deltaDistanceKm: number;
  estimatedArrival: string; // HH:MM:SS
  slackBeforeMinutes: number;
  slackAfterMinutes: number;
  dayLoadPercent: number;
  status: 'ok' | 'tight' | 'conflict';
  reason: string;
}

export interface SlotWarning {
  severity: 'error' | 'warning';
  warningType: string; // overlap | unreachable | no_slack | overloaded | break_conflict | no_crews | routing_fallback
  message: string;
  conflictingCustomer?: string;
}

export interface SuggestSlotsV2Response {
  suggestions: CrewSlotSuggestion[];
  warnings: SlotWarning[];
}

export interface ValidateSlotRequest {
  date: string; // YYYY-MM-DD
  customerId: string;
  crewId: string;
  timeStart: string; // HH:MM
  timeEnd: string; // HH:MM
}

export interface ValidateSlotResponse {
  feasible: boolean;
  warnings: SlotWarning[];
  estimatedArrival?: string; // HH:MM:SS
  slackBeforeMinutes?: number;
  slackAfterMinutes?: number;
}

// ── Helpers ──

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

// ── V1 API (legacy) ──

/**
 * Get suggested time slots for a new appointment (v1 — single crew, Haversine)
 * @deprecated Use suggestSlotsV2 for multi-crew Valhalla-backed suggestions
 */
export async function suggestSlots(
  request: SuggestSlotsRequest
): Promise<SuggestSlotsResponse> {
  const { request: natsRequest } = useNatsStore.getState();
  
  const response = await natsRequest<SuggestSlotsRequest, NatsResponse<SuggestSlotsResponse>>(
    'sazinka.slots.suggest',
    request
  );
  
  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }
  
  return response.payload;
}

// ── V2 API (multi-crew, Valhalla) ──

/**
 * Get suggested time slots across all (or selected) crews using Valhalla routing.
 * Returns per-crew suggestions with scores + warnings.
 */
export async function suggestSlotsV2(
  request: SuggestSlotsV2Request
): Promise<SuggestSlotsV2Response> {
  const { request: natsRequest } = useNatsStore.getState();

  const response = await natsRequest<SuggestSlotsV2Request, NatsResponse<SuggestSlotsV2Response>>(
    'sazinka.slots.suggest.v2',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Validate a manually entered slot against the crew's schedule.
 * Returns feasibility + warnings (overlap, unreachable, no_slack, etc.)
 */
export async function validateSlot(
  request: ValidateSlotRequest
): Promise<ValidateSlotResponse> {
  const { request: natsRequest } = useNatsStore.getState();

  const response = await natsRequest<ValidateSlotRequest, NatsResponse<ValidateSlotResponse>>(
    'sazinka.slots.validate',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ── Formatting utilities ──

/**
 * Format time string for display (HH:MM)
 */
export function formatSlotTime(time: string): string {
  // time is HH:MM:SS, return HH:MM
  return time.substring(0, 5);
}

/**
 * Generate slot description
 */
export function getSlotDescription(slot: SuggestedSlot | CrewSlotSuggestion): string {
  const start = formatSlotTime(slot.startTime);
  const end = formatSlotTime(slot.endTime);
  return `${start} - ${end}`;
}

/**
 * Get score color based on value
 */
export function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 60) return 'var(--color-warning)';
  return 'var(--color-error)';
}

/**
 * Get status color for crew slot suggestion
 */
export function getStatusColor(status: CrewSlotSuggestion['status']): string {
  switch (status) {
    case 'ok': return 'var(--color-success)';
    case 'tight': return 'var(--color-warning)';
    case 'conflict': return 'var(--color-error)';
    default: return 'var(--color-text-secondary)';
  }
}

/**
 * Get warning severity color
 */
export function getWarningSeverityColor(severity: SlotWarning['severity']): string {
  return severity === 'error' ? 'var(--color-error)' : 'var(--color-warning)';
}

/**
 * Group suggestions by crew
 */
export function groupSuggestionsByCrew(
  suggestions: CrewSlotSuggestion[]
): Map<string, { crewName: string; dayLoadPercent: number; suggestions: CrewSlotSuggestion[] }> {
  const grouped = new Map<string, { crewName: string; dayLoadPercent: number; suggestions: CrewSlotSuggestion[] }>();

  for (const s of suggestions) {
    const existing = grouped.get(s.crewId);
    if (existing) {
      existing.suggestions.push(s);
    } else {
      grouped.set(s.crewId, {
        crewName: s.crewName,
        dayLoadPercent: s.dayLoadPercent,
        suggestions: [s],
      });
    }
  }

  return grouped;
}
