/**
 * Communication service for CRM
 */

import type {
  Communication,
  CreateCommunicationRequest,
  UpdateCommunicationRequest,
  ListCommunicationsRequest,
  ListCommunicationsResponse,
} from '@sazinka/shared-types';
import { useNatsStore } from '../stores/natsStore';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface CommunicationServiceDeps {
  request: <TRes>(subject: string, payload: unknown) => Promise<TRes>;
}

function getDefaultDeps(): CommunicationServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

/**
 * Create a new communication
 */
export async function createCommunication(
  data: CreateCommunicationRequest,
  deps = getDefaultDeps()
): Promise<Communication> {
  const response = await deps.request<{ payload: Communication }>(
    'sazinka.communication.create',
    {
      userId: TEMP_USER_ID,
      payload: data,
    }
  );
  return response.payload;
}

/**
 * List communications with filters
 */
export async function listCommunications(
  filters: ListCommunicationsRequest = {},
  deps = getDefaultDeps()
): Promise<ListCommunicationsResponse> {
  const response = await deps.request<{ payload: ListCommunicationsResponse }>(
    'sazinka.communication.list',
    {
      userId: TEMP_USER_ID,
      payload: filters,
    }
  );
  return response.payload;
}

/**
 * List communications for a specific customer
 */
export async function listCustomerCommunications(
  customerId: string,
  limit = 50,
  deps = getDefaultDeps()
): Promise<Communication[]> {
  const response = await listCommunications({ customerId, limit }, deps);
  return response.communications;
}

/**
 * Update a communication
 */
export async function updateCommunication(
  data: UpdateCommunicationRequest,
  deps = getDefaultDeps()
): Promise<Communication> {
  const response = await deps.request<{ payload: Communication }>(
    'sazinka.communication.update',
    {
      userId: TEMP_USER_ID,
      payload: data,
    }
  );
  return response.payload;
}

/**
 * Delete a communication
 */
export async function deleteCommunication(
  id: string,
  deps = getDefaultDeps()
): Promise<boolean> {
  const response = await deps.request<{ payload: { deleted: boolean } }>(
    'sazinka.communication.delete',
    {
      userId: TEMP_USER_ID,
      payload: { id },
    }
  );
  return response.payload.deleted;
}

/**
 * Get communication type label
 */
export function getCommunicationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    email_sent: 'Odeslaný e-mail',
    email_received: 'Přijatý e-mail',
    call: 'Telefonát',
    note: 'Poznámka',
    sms: 'SMS',
  };
  return labels[type] || type;
}

/**
 * Get communication type icon
 */
export function getCommunicationTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    email_sent: '📤',
    email_received: '📥',
    call: '📞',
    note: '📝',
    sms: '💬',
  };
  return icons[type] || '📄';
}
