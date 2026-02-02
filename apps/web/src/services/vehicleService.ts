/**
 * Vehicle service - handles vehicle CRUD operations
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

export interface Vehicle {
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

export interface VehicleListResponse {
  items: Vehicle[];
  total: number;
}

export interface ListVehiclesRequest {
  activeOnly?: boolean;
}

/**
 * List all vehicles for user
 */
export async function listVehicles(
  activeOnly = true,
  deps = { request: useNatsStore.getState().request }
): Promise<Vehicle[]> {
  const request = createRequest<ListVehiclesRequest>(TEMP_USER_ID, { activeOnly });

  const response = await deps.request<typeof request, NatsResponse<VehicleListResponse>>(
    'sazinka.vehicle.list',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.items;
}
