import type { Device, CreateDeviceRequest } from '@shared/device';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

/**
 * Dependencies for device service (for testing)
 */
export interface DeviceServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): DeviceServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

/**
 * Response type that can be either success or error
 */
type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Type guard to check if response is an error
 */
function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
}

/**
 * Update device request type
 */
export interface UpdateDeviceRequest {
  id: string;
  deviceType?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  revisionIntervalMonths?: number;
  notes?: string;
}

/**
 * Device list response
 */
export interface DeviceListResponse {
  items: Device[];
  total: number;
}

/**
 * Create a new device
 */
export async function createDevice(
  userId: string,
  data: CreateDeviceRequest,
  deps: DeviceServiceDeps = getDefaultDeps()
): Promise<Device> {
  const request = createRequest(userId, data);

  const response = await deps.request<typeof request, NatsResponse<Device>>(
    'sazinka.device.create',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * List devices for a customer
 */
export async function listDevices(
  userId: string,
  customerId: string,
  deps: DeviceServiceDeps = getDefaultDeps()
): Promise<DeviceListResponse> {
  const request = createRequest(userId, { customerId });

  const response = await deps.request<typeof request, NatsResponse<DeviceListResponse>>(
    'sazinka.device.list',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get a single device by ID
 */
export async function getDevice(
  userId: string,
  deviceId: string,
  customerId: string,
  deps: DeviceServiceDeps = getDefaultDeps()
): Promise<Device> {
  const request = createRequest(userId, { id: deviceId, customerId });

  const response = await deps.request<typeof request, NatsResponse<Device>>(
    'sazinka.device.get',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update a device
 */
export async function updateDevice(
  userId: string,
  customerId: string,
  data: UpdateDeviceRequest,
  deps: DeviceServiceDeps = getDefaultDeps()
): Promise<Device> {
  const request = createRequest(userId, { ...data, customerId });

  const response = await deps.request<typeof request, NatsResponse<Device>>(
    'sazinka.device.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Delete a device
 */
export async function deleteDevice(
  userId: string,
  deviceId: string,
  customerId: string,
  deps: DeviceServiceDeps = getDefaultDeps()
): Promise<boolean> {
  const request = createRequest(userId, { id: deviceId, customerId });

  const response = await deps.request<typeof request, NatsResponse<{ deleted: boolean }>>(
    'sazinka.device.delete',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.deleted;
}
