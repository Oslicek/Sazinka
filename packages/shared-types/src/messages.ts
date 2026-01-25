// NATS message types

export interface Request<T> {
  id: string;
  timestamp: string;
  userId?: string;
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

// Helper type to create request payloads
export function createRequest<T>(userId: string | undefined, payload: T): Request<T> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId,
    payload,
  };
}
