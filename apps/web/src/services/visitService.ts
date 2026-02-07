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
  const labels: Record<string, string> = {
    planned: 'Naplánováno',
    in_progress: 'Probíhá',
    completed: 'Dokončeno',
    cancelled: 'Zrušeno',
    rescheduled: 'Přeplánováno',
  };
  return labels[status] || status;
}

/**
 * Get visit type label
 */
export function getVisitTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    revision: 'Revize',
    installation: 'Instalace',
    repair: 'Oprava',
    consultation: 'Konzultace',
    follow_up: 'Následná návštěva',
  };
  return labels[type] || type;
}

/**
 * Get visit result label
 */
export function getVisitResultLabel(result: string): string {
  const labels: Record<string, string> = {
    successful: 'Úspěšná',
    partial: 'Částečná',
    failed: 'Neúspěšná',
    customer_absent: 'Zákazník nepřítomen',
    rescheduled: 'Přeplánováno',
  };
  return labels[result] || result;
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
