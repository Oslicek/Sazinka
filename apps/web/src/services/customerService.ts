import type { CreateCustomerRequest, Customer } from '@shared/customer';
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
