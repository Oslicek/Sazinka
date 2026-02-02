/**
 * Slot suggestion service
 * Handles NATS communication for smart slot suggestions
 */

import { publish } from '../stores/natsStore';

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

/**
 * Get suggested time slots for a new appointment
 */
export async function suggestSlots(
  userId: string,
  request: SuggestSlotsRequest
): Promise<SuggestSlotsResponse> {
  const response = await publish<SuggestSlotsResponse>(
    'sazinka.slots.suggest',
    request,
    userId
  );
  return response;
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
