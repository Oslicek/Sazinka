import type { 
  CreateCustomerRequest, 
  Customer, 
  GeocodeRequest, 
  GeocodeResponse,
  ImportBatchRequest,
  ImportBatchResponse,
  ImportIssue,
} from '@shared/customer';
import type { ListRequest, ListResponse, SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';

/**
 * Dependencies for customer service (for testing)
 */
export interface CustomerServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

/**
 * Get default dependencies from NATS store
 */
function getDefaultDeps(): CustomerServiceDeps {
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
 * Create a new customer
 */
export async function createCustomer(
  userId: string,
  data: CreateCustomerRequest,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<Customer> {
  const request = createRequest(userId, data);
  
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
  userId: string,
  options: ListRequest = {},
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<ListResponse<Customer>> {
  const request = createRequest(userId, options);

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
 * Get a single customer by ID
 */
export async function getCustomer(
  userId: string,
  customerId: string,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<Customer> {
  const request = createRequest(userId, { id: customerId });

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
 * Geocode an address to coordinates
 * 
 * This does not create a customer - it just returns coordinates for the address.
 * Useful for showing the location on a map before saving.
 */
export async function geocodeAddress(
  userId: string,
  address: GeocodeRequest,
  deps: CustomerServiceDeps = getDefaultDeps()
): Promise<GeocodeResponse> {
  const request = createRequest(userId, address);

  const response = await deps.request<typeof request, NatsResponse<GeocodeResponse>>(
    'sazinka.customer.geocode',
    request
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error.message);
  }

  return response.payload;
}

/**
 * Import a batch of customers
 * 
 * For large imports, this should be called multiple times with smaller batches.
 * Each batch is processed atomically on the server.
 */
export async function importCustomersBatch(
  userId: string,
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
      await createCustomer(userId, customers[i], deps);
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
