// NATS message types

export interface Request<T> {
  id: string;
  timestamp: string;
  userId?: string;  // Legacy - ignored by backend when token is present
  token?: string;   // JWT access token (preferred)
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
 * @param tokenOrUserId - JWT token string, or legacy userId (for backward compat during migration)
 * @param payload - The request payload
 */
export function createRequest<T>(tokenOrUserId: string | undefined, payload: T): Request<T> {
  // Detect if it's a JWT token (contains dots) or a legacy userId (UUID format)
  const isToken = tokenOrUserId && tokenOrUserId.includes('.');
  
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId: isToken ? undefined : tokenOrUserId,
    token: isToken ? tokenOrUserId : undefined,
    payload,
  };
}
