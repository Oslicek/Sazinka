/**
 * Visit service for CRM
 */

import type {
  Visit,
  CreateVisitRequest,
  UpdateVisitRequest,
  CompleteVisitRequest,
  ListVisitsRequest,
  ListVisitsResponse,
} from '@shared/visit';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';
import i18n from '@/i18n';

export interface VisitServiceDeps {
  request: <TRes>(subject: string, payload: unknown) => Promise<TRes>;
}

function getDefaultDeps(): VisitServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

/**
 * Create a new visit
 */
export async function createVisit(
  data: CreateVisitRequest,
  deps = getDefaultDeps()
): Promise<Visit> {
  const request = createRequest(getToken(), data);
  const response = await deps.request<{ payload: Visit }>(
    'sazinka.visit.create',
    request
  );
  return response.payload;
}

/**
 * Get a single visit by ID (with customer data and work items)
 */
export async function getVisit(
  visitId: string,
  deps = getDefaultDeps()
): Promise<{
  visit: Visit;
  customerName: string | null;
  customerStreet: string | null;
  customerCity: string | null;
  customerPostalCode: string | null;
  customerPhone: string | null;
  customerLat: number | null;
  customerLng: number | null;
  workItems: Array<{
    id: string;
    visitId: string;
    deviceId?: string | null;
    revisionId?: string | null;
    crewId?: string | null;
    workType: string;
    durationMinutes?: number | null;
    result?: string | null;
    resultNotes?: string | null;
    findings?: string | null;
    requiresFollowUp: boolean;
    followUpReason?: string | null;
    createdAt: string;
  }>;
}> {
  const request = createRequest(getToken(), { id: visitId });
  const response = await deps.request<{ payload: any }>(
    'sazinka.visit.get',
    request
  );
  return response.payload;
}

/**
 * List visits with filters
 */
export async function listVisits(
  filters: ListVisitsRequest = {},
  deps = getDefaultDeps()
): Promise<ListVisitsResponse> {
  const request = createRequest(getToken(), filters);
  const response = await deps.request<{ payload: ListVisitsResponse }>(
    'sazinka.visit.list',
    request
  );
  return response.payload;
}

/**
 * List visits for a specific customer
 */
export async function listCustomerVisits(
  customerId: string,
  limit = 50,
  deps = getDefaultDeps()
): Promise<Visit[]> {
  const response = await listVisits({ customerId, limit }, deps);
  return response.visits;
}

/**
 * Update a visit
 */
export async function updateVisit(
  data: UpdateVisitRequest,
  deps = getDefaultDeps()
): Promise<Visit> {
  const request = createRequest(getToken(), data);
  const response = await deps.request<{ payload: Visit }>(
    'sazinka.visit.update',
    request
  );
  return response.payload;
}

/**
 * Complete a visit
 */
export async function completeVisit(
  data: CompleteVisitRequest,
  deps = getDefaultDeps()
): Promise<Visit> {
  const request = createRequest(getToken(), data);
  const response = await deps.request<{ payload: Visit }>(
    'sazinka.visit.complete',
    request
  );
  return response.payload;
}

/**
 * Delete a visit
 */
export async function deleteVisit(
  id: string,
  deps = getDefaultDeps()
): Promise<boolean> {
  const request = createRequest(getToken(), { id });
  const response = await deps.request<{ payload: { deleted: boolean } }>(
    'sazinka.visit.delete',
    request
  );
  return response.payload.deleted;
}

/**
 * Get visit status label
 */
export function getVisitStatusLabel(status: string): string {
  const key = `common:visit_status.${status}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : status;
}

/**
 * Get visit type label
 */
export function getVisitTypeLabel(type: string): string {
  const key = `common:visit_type.${type}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : type;
}

/**
 * Get visit result label
 */
export function getVisitResultLabel(result: string): string {
  const key = `common:visit_result.${result}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : result;
}

/**
 * Get visit status icon
 */
export function getVisitStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    planned: '📅',
    in_progress: '🔄',
    completed: '✅',
    cancelled: '❌',
    rescheduled: '🔁',
  };
  return icons[status] || '📋';
}
