// Customer types

export interface Customer {
  id: string;
  userId: string;
  name: string;
  email?: string;
  phone?: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  lat?: number;
  lng?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerRequest {
  name: string;
  email?: string;
  phone?: string;
  street: string;
  city: string;
  postalCode: string;
  country?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

export interface UpdateCustomerRequest {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}
