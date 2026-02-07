import type { 
  CreateCustomerRequest,
  UpdateCustomerRequest,
  Customer, 
  ImportIssue,
  CustomerListResponse,
  CustomerSummary,
  ListCustomersRequest,
} from '@shared/customer';
import type { ListRequest, ListResponse, SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

/**
 * Dependencies for customer service (for testing)
 */
export interface CustomerServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
  subscribe?: <T>(subject: string, callback: (msg: T) => void) => Promise<() => void>;
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): CustomerServiceDeps {
  return {
    request: useNatsStore.getState().request,
    subscribe: useNatsStore.getState().subscribe,
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
 * Create a new customer
 */
export async function createCustomer(
  data: CreateCustomerRequest,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<Customer> {
  const request = createRequest(getToken(), data);
  
  const response = await deps.request<typeof request, NatsResponse<Customer>>(
    'sazinka.customer.create',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * List customers with pagination
 */
export async function listCustomers(
  options: ListRequest = {},
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<ListResponse<Customer>> {
  const request = createRequest(getToken(), options);

  const response = await deps.request<typeof request, NatsResponse<ListResponse<Customer>>>(
    'sazinka.customer.list',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * List customers with extended data (device count, next revision, overdue count)
 * Supports filtering and sorting
 */
export async function listCustomersExtended(
  options: ListCustomersRequest = {},
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<CustomerListResponse> {
  const request = createRequest(getToken(), options);

  const response = await deps.request<typeof request, NatsResponse<CustomerListResponse>>(
    'sazinka.customer.list.extended',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get customer summary statistics
 */
export async function getCustomerSummary(
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<CustomerSummary> {
  const request = createRequest(getToken(), {});

  const response = await deps.request<typeof request, NatsResponse<CustomerSummary>>(
    'sazinka.customer.summary',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Get a single customer by ID
 */
export async function getCustomer(
  customerId: string,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<Customer> {
  const request = createRequest(getToken(), { id: customerId });

  const response = await deps.request<typeof request, NatsResponse<Customer>>(
    'sazinka.customer.get',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Update a customer
 */
export async function updateCustomer(
  data: UpdateCustomerRequest,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<Customer> {
  const request = createRequest(getToken(), data);

  const response = await deps.request<typeof request, NatsResponse<Customer>>(
    'sazinka.customer.update',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Delete a customer
 */
export async function deleteCustomer(
  customerId: string,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<boolean> {
  const request = createRequest(getToken(), { id: customerId });

  const response = await deps.request<typeof request, NatsResponse<{ deleted: boolean }>>(
    'sazinka.customer.delete',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload.deleted;
}

/**
 * Import a batch of customers
 * 
 * For large imports, this should be called multiple times with smaller batches.
 * Each batch is processed atomically on the server.
 */
export async function importCustomersBatch(
  customers: CreateCustomerRequest[],
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<{ importedCount: number; updatedCount: number; errors: ImportIssue[] }> {
  // For now, create customers one by one since we don't have batch endpoint yet
  // TODO: Implement batch endpoint on server for better performance
  let importedCount = 0;
  let updatedCount = 0;
  const errors: ImportIssue[] = [];

  for (let i = 0; i < customers.length; i++) {
    try {
      await createCustomer(customers[i], deps);
      importedCount++;
    } catch (error) {
      errors.push({
        rowNumber: i + 1,
        level: 'error',
        field: 'server',
        message: error instanceof Error ? error.message : 'Nepodařilo se uložit zákazníka',
      });
    }
  }

  return { importedCount, updatedCount, errors };
}

// ==========================================================================
// Geocoding Job API
// ==========================================================================

/**
 * Get customers pending geocoding (without coordinates)
 */
export interface PendingGeocodeCustomer {
  id: string;
  name: string;
  address: string;
}

export interface PendingGeocodeResponse {
  count: number;
  customers: PendingGeocodeCustomer[];
}

export async function getCustomersPendingGeocode(
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<PendingGeocodeResponse> {
  const request = createRequest(getToken(), {});

  const response = await deps.request<typeof request, NatsResponse<PendingGeocodeResponse>>(
    'sazinka.geocode.pending',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Submit a batch geocoding job for customers without coordinates
 */
export interface GeocodeJobSubmitResponse {
  jobId: string;
  message: string;
}

export async function submitGeocodeJob(
  customerIds: string[],
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<GeocodeJobSubmitResponse> {
  const request = createRequest(getToken(), { 
    customerIds 
  });

  const response = await deps.request<typeof request, NatsResponse<GeocodeJobSubmitResponse>>(
    'sazinka.geocode.submit',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

// ==========================================================================
// Geocode Address Preview (async)
// ==========================================================================

export interface GeocodeAddressJobSubmitResponse {
  jobId: string;
  message: string;
}

export async function submitGeocodeAddressJob(
  address: { street: string; city: string; postalCode: string },
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<GeocodeAddressJobSubmitResponse> {
  const request = createRequest(getToken(), {
    street: address.street,
    city: address.city,
    postalCode: address.postalCode,
  });

  const response = await deps.request<typeof request, NatsResponse<GeocodeAddressJobSubmitResponse>>(
    'sazinka.geocode.address.submit',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

export type GeocodeAddressJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'processing' }
  | { type: 'completed'; coordinates: { lat: number; lng: number }; displayName?: string }
  | { type: 'failed'; error: string };

export interface GeocodeAddressJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: GeocodeAddressJobStatus;
}

export async function subscribeToGeocodeAddressJobStatus(
  jobId: string,
  callback: (update: GeocodeAddressJobStatusUpdate) => void,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('subscribe is not available');
  }

  const subject = `sazinka.job.geocode.address.status.${jobId}`;
  return deps.subscribe<GeocodeAddressJobStatusUpdate>(subject, callback);
}

// ==========================================================================
// Reverse Geocoding (async)
// ==========================================================================

export interface ReverseGeocodeJobSubmitResponse {
  jobId: string;
  message: string;
}

export async function submitReverseGeocodeJob(
  payload: { customerId: string; lat: number; lng: number },
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<ReverseGeocodeJobSubmitResponse> {
  const request = createRequest(getToken(), payload);

  const response = await deps.request<typeof request, NatsResponse<ReverseGeocodeJobSubmitResponse>>(
    'sazinka.geocode.reverse.submit',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

export type ReverseGeocodeJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'processing' }
  | { type: 'completed'; street: string; city: string; postalCode: string; displayName?: string }
  | { type: 'failed'; error: string };

export interface ReverseGeocodeJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: ReverseGeocodeJobStatus;
}

export async function subscribeToReverseGeocodeJobStatus(
  jobId: string,
  callback: (update: ReverseGeocodeJobStatusUpdate) => void,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('subscribe is not available');
  }

  const subject = `sazinka.job.geocode.reverse.status.${jobId}`;
  return deps.subscribe<ReverseGeocodeJobStatusUpdate>(subject, callback);
}

// ==========================================================================
// Geocoding Job Status (async updates)
// ==========================================================================

export type GeocodeJobStatus =
  | { type: 'queued'; position: number }
  | { type: 'processing'; processed: number; total: number; succeeded: number; failed: number }
  | { type: 'completed'; total: number; succeeded: number; failed: number; failedAddresses: string[] }
  | { type: 'failed'; error: string };

export interface GeocodeJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: GeocodeJobStatus;
}

export async function subscribeToGeocodeJobStatus(
  jobId: string,
  callback: (update: GeocodeJobStatusUpdate) => void,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<() => void> {
  if (!deps.subscribe) {
    throw new Error('subscribe is not available');
  }

  const subject = `sazinka.job.geocode.status.${jobId}`;
  return deps.subscribe<GeocodeJobStatusUpdate>(subject, callback);
}

/**
 * Submit geocoding for all customers without coordinates
 */
export async function submitGeocodeAllPending(
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<GeocodeJobSubmitResponse | null> {
  // First, get all customers pending geocode
  const pending = await getCustomersPendingGeocode(deps);
  
  if (pending.count === 0) {
    return null; // Nothing to geocode
  }
  
  // Submit geocoding job for all of them
  const customerIds = pending.customers.map(c => c.id);
  return submitGeocodeJob(customerIds, deps);
}
