import type {
  DeviceTypeConfigWithFields,
  DeviceTypeConfigListResponse,
  ListDeviceTypeConfigsRequest,
  GetDeviceTypeConfigRequest,
  UpdateDeviceTypeConfigRequest,
  CreateDeviceTypeFieldRequest,
  UpdateDeviceTypeFieldRequest,
  SetFieldActiveRequest,
  ReorderFieldsRequest,
  DeviceTypeField,
} from '@shared/deviceTypeConfig';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

/**
 * Dependencies for deviceTypeConfigService (for testing)
 */
export interface DeviceTypeConfigServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

function getDefaultDeps(): DeviceTypeConfigServiceDeps {
  return { request: useNatsStore.getState().request };
}

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(r: NatsResponse<unknown>): r is ErrorResponse {
  return 'error' in r;
}

// ============================================================================
// Device type config API
// ============================================================================

/**
 * List all device type configs for the current tenant (with their fields).
 * By default returns only active types; pass includeInactive: true for settings UI.
 */
export async function listDeviceTypeConfigs(
  options: ListDeviceTypeConfigsRequest = {},
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<DeviceTypeConfigWithFields[]> {
  const req = createRequest(getToken(), options);

  const response = await deps.request<typeof req, NatsResponse<DeviceTypeConfigListResponse>>(
    'sazinka.device_type_config.list',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload.items;
}

/**
 * Get a single device type config with all its fields.
 */
export async function getDeviceTypeConfig(
  payload: GetDeviceTypeConfigRequest,
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<DeviceTypeConfigWithFields> {
  const req = createRequest(getToken(), payload);

  const response = await deps.request<typeof req, NatsResponse<DeviceTypeConfigWithFields>>(
    'sazinka.device_type_config.get',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

/**
 * Update a device type config (label, isActive, default durations, sortOrder).
 * deviceTypeKey is immutable and not part of this payload.
 */
export async function updateDeviceTypeConfig(
  payload: UpdateDeviceTypeConfigRequest,
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<DeviceTypeConfigWithFields> {
  const req = createRequest(getToken(), payload);

  const response = await deps.request<typeof req, NatsResponse<DeviceTypeConfigWithFields>>(
    'sazinka.device_type_config.update',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

// ============================================================================
// Device type field API
// ============================================================================

/**
 * Add a new field to a device type template.
 * fieldKey and fieldType are set at creation and are immutable afterwards.
 */
export async function createDeviceTypeField(
  payload: CreateDeviceTypeFieldRequest,
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<DeviceTypeField> {
  const req = createRequest(getToken(), payload);

  const response = await deps.request<typeof req, NatsResponse<DeviceTypeField>>(
    'sazinka.device_type_field.create',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

/**
 * Update mutable field attributes (label, isRequired, defaultValue, selectOptions, unit, placeholder).
 * fieldKey and fieldType are immutable and not accepted in this payload.
 */
export async function updateDeviceTypeField(
  payload: UpdateDeviceTypeFieldRequest,
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<DeviceTypeField> {
  const req = createRequest(getToken(), payload);

  const response = await deps.request<typeof req, NatsResponse<DeviceTypeField>>(
    'sazinka.device_type_field.update',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

/**
 * Activate or deactivate a field.
 * Existing device values are preserved on deactivation.
 * Reactivation restores the field; existing values remain intact.
 */
export async function setFieldActive(
  payload: SetFieldActiveRequest,
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<boolean> {
  const req = createRequest(getToken(), payload);

  const response = await deps.request<typeof req, NatsResponse<{ updated: boolean }>>(
    'sazinka.device_type_field.set_active',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload.updated;
}

/**
 * Reorder fields within a device type config.
 * Payload: { deviceTypeConfigId, fieldIds: UUID[] } — fieldIds in desired order.
 */
export async function reorderFields(
  payload: ReorderFieldsRequest,
  deps: DeviceTypeConfigServiceDeps = getDefaultDeps()
): Promise<boolean> {
  const req = createRequest(getToken(), payload);

  const response = await deps.request<typeof req, NatsResponse<{ reordered: boolean }>>(
    'sazinka.device_type_field.reorder',
    req
  );

  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload.reordered;
}
