// Authentication types

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  businessName?: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'customer' | 'worker';
  phone?: string;
  businessName?: string;
}

export interface AuthResponse {
  token: string;
  user: UserPublic;
}

export interface VerifyRequest {
  token: string;
}

export interface CreateWorkerRequest {
  email: string;
  password: string;
  name: string;
}

export interface DeleteWorkerRequest {
  id: string;
}
