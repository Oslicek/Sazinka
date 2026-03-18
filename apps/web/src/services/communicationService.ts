/**
 * Communication service for CRM
 */

import type {
  Communication,
  CreateCommunicationRequest,
  ListCommunicationsRequest,
  ListCommunicationsResponse,
} from '@shared/communication';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';
import i18n from '@/i18n';

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
  const request = createRequest(getToken(), data);
  const response = await deps.request<{ payload: Communication }>(
    'sazinka.communication.create',
    request
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
  const request = createRequest(getToken(), filters);
  const response = await deps.request<{ payload: ListCommunicationsResponse }>(
    'sazinka.communication.list',
    request
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
 * Get communication type label
 */
export function getCommunicationTypeLabel(type: string): string {
  const key = `common:communication_type.${type}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : type;
}

/**
 * Get communication type icon
 */
