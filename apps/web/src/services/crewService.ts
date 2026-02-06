/**
 * Crew service - handles crew (posádka) CRUD operations
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

export interface Crew {
  id: string;
  userId: string;
  name: string;
  homeDepotId: string | null;
  preferredAreas: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrewListResponse {
  items: Crew[];
  total: number;
}

export interface CreateCrewRequest {
  name: string;
  homeDepotId?: string;
  preferredAreas?: string[];
  workingHoursStart?: string;
  workingHoursEnd?: string;
}

export interface UpdateCrewRequest {
  id: string;
  name?: string;
  homeDepotId?: string;
  preferredAreas?: string[];
  workingHoursStart?: string;
  workingHoursEnd?: string;
  isActive?: boolean;
}

export interface ListCrewsRequest {
  activeOnly?: boolean;
}

export interface DeleteCrewRequest {
  id: string;
}

export interface GetCrewRequest {
  id: string;
}

// Dependency injection type for testing
export interface CrewServiceDeps {
  request: ReturnType<typeof useNatsStore.getState>['request'];
}

/**
 * Create a new crew
 */
export async function createCrew(
  data: CreateCrewRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<Crew> {
  const request = createRequest<CreateCrewRequest>(TEMP_USER_ID, data);

  const response = await deps.request<typeof request, NatsResponse<Crew>>(
    'sazinka.crew.create',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * List all crews for user
 */
export async function listCrews(
  activeOnly = true,
  deps = { request: useNatsStore.getState().request }
): Promise<Crew[]> {
  const request = createRequest<ListCrewsRequest>(TEMP_USER_ID, { activeOnly });

  const response = await deps.request<typeof request, NatsResponse<CrewListResponse>>(
    'sazinka.crew.list',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.items;
}

/**
 * Get a single crew by ID
 */
export async function getCrew(
  id: string,
  deps = { request: useNatsStore.getState().request }
): Promise<Crew> {
  const request = createRequest<GetCrewRequest>(TEMP_USER_ID, { id });

  const response = await deps.request<typeof request, NatsResponse<Crew>>(
    'sazinka.crew.get',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update a crew
 */
export async function updateCrew(
  data: UpdateCrewRequest,
  deps = { request: useNatsStore.getState().request }
): Promise<Crew> {
  const request = createRequest<UpdateCrewRequest>(TEMP_USER_ID, data);

  const response = await deps.request<typeof request, NatsResponse<Crew>>(
    'sazinka.crew.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Delete a crew (soft delete)
 */
export async function deleteCrew(
  id: string,
  deps = { request: useNatsStore.getState().request }
): Promise<boolean> {
  const request = createRequest<DeleteCrewRequest>(TEMP_USER_ID, { id });

  const response = await deps.request<typeof request, NatsResponse<{ deleted: boolean }>>(
    'sazinka.crew.delete',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.deleted;
}
