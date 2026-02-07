/**
 * Slot suggestion service
 * Handles NATS communication for smart slot suggestions
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

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

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

/**
 * Get suggested time slots for a new appointment
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
export function getSlotDescription(slot: SuggestedSlot): string {
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
