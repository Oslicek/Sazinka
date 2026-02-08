import type {
  Depot,
  CreateDepotRequest,
  UpdateDepotRequest,
  DeleteDepotRequest,
  ListDepotsResponse,
  UserSettings,
  WorkConstraints,
  BusinessInfo,
  EmailTemplateSettings,
  UpdateWorkConstraintsRequest,
  UpdateBusinessInfoRequest,
  UpdateEmailTemplatesRequest,
} from '@shared/settings';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

/**
 * Dependencies for settings service (for testing)
 */
export interface SettingsServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): SettingsServiceDeps {
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

// ============================================================================
// User Settings API
// ============================================================================

/**
 * Get all user settings including depots
 */
export async function getSettings(
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<UserSettings> {
  const request = createRequest(getToken(), {});

  const response = await deps.request<typeof request, NatsResponse<UserSettings>>(
    'sazinka.settings.get',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update work constraints
 */
export async function updateWorkConstraints(
  data: UpdateWorkConstraintsRequest,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<WorkConstraints> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<WorkConstraints>>(
    'sazinka.settings.work.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update business info
 */
export async function updateBusinessInfo(
  data: UpdateBusinessInfoRequest,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<BusinessInfo> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<BusinessInfo>>(
    'sazinka.settings.business.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update email templates
 */
export async function updateEmailTemplates(
  data: UpdateEmailTemplatesRequest,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<EmailTemplateSettings> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<EmailTemplateSettings>>(
    'sazinka.settings.email.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ============================================================================
// User Preferences API
// ============================================================================

export interface UpdatePreferencesRequest {
  defaultCrewId: string | null;
  defaultDepotId: string | null;
}

export interface UserPreferences {
  defaultCrewId: string | null;
  defaultDepotId: string | null;
}

/**
 * Update user preferences (default crew, depot)
 */
export async function updatePreferences(
  data: UpdatePreferencesRequest,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<UserPreferences> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<UserPreferences>>(
    'sazinka.settings.preferences.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ============================================================================
// Depot API
// ============================================================================

/**
 * List all depots for user
 */
export async function listDepots(
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<Depot[]> {
  const request = createRequest(getToken(), {});

  const response = await deps.request<typeof request, NatsResponse<ListDepotsResponse>>(
    'sazinka.depot.list',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.depots;
}

/**
 * Create a new depot
 */
export async function createDepot(
  data: CreateDepotRequest,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<Depot> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<Depot>>(
    'sazinka.depot.create',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update a depot
 */
export async function updateDepot(
  data: UpdateDepotRequest,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<Depot> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<Depot>>(
    'sazinka.depot.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Delete a depot
 */
export async function deleteDepot(
  depotId: string,
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<boolean> {
  const request = createRequest(getToken(), { id: depotId } as DeleteDepotRequest);

  const response = await deps.request<typeof request, NatsResponse<{ deleted: boolean }>>(
    'sazinka.depot.delete',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.deleted;
}

/**
 * Geocode depot address response
 */
export interface GeocodeDepotResponse {
  coordinates: { lat: number; lng: number } | null;
  displayName: string | null;
  geocoded: boolean;
}

/**
 * Geocode an address for depot
 */
export async function geocodeDepotAddress(
  address: { street: string; city: string; postalCode: string },
  deps: SettingsServiceDeps = getDefaultDeps()
): Promise<GeocodeDepotResponse> {
  const request = createRequest(getToken(), address);

  const response = await deps.request<typeof request, NatsResponse<GeocodeDepotResponse>>(
    'sazinka.depot.geocode',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}
