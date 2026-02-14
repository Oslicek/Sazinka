// NATS message types

export interface Request<T> {
  id: string;
  timestamp: string;
  token?: string;   // JWT access token
  payload: T;
}

export interface SuccessResponse<T> {
  id: string;
  timestamp: string;
  payload: T;
}

export interface ErrorResponse {
  id: string;
  timestamp: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ListRequest {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Create a NATS request with JWT token authentication.
 * @param token - JWT access token
 * @param payload - The request payload
 */
export function createRequest<T>(token: string | undefined, payload: T): Request<T> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    token,
    payload,
  };
}
