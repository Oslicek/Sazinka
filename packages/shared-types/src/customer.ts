// Customer types

export type CustomerType = 'person' | 'company';

export type GeocodeStatus = 'pending' | 'success' | 'failed';

export interface Customer {
  id: string;
  userId: string;
  type: CustomerType;
  name: string;
  contactPerson?: string;  // Only for companies
  ico?: string;            // IČO - 8 digits (companies only)
  dic?: string;            // DIČ - CZ + 8-10 digits (companies only)
  email?: string;
  phone?: string;
  phoneRaw?: string;       // Original phone if normalization failed
  street: string;
  city: string;
  postalCode: string;
  country: string;
  lat?: number;
  lng?: number;
  geocodeStatus: GeocodeStatus;  // Geocoding status: pending, success, failed
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerRequest {
  type?: CustomerType;
  name: string;
  contactPerson?: string;
  ico?: string;
  dic?: string;
  email?: string;
  phone?: string;
  phoneRaw?: string;
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
  type?: CustomerType;
  name?: string;
  contactPerson?: string;
  ico?: string;
  dic?: string;
  email?: string;
  phone?: string;
  phoneRaw?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

// Geocoding types

export interface GeocodeRequest {
  street: string;
  city: string;
  postalCode: string;
}

export interface GeocodeResponse {
  coordinates: Coordinates | null;
  confidence: number | null;
  displayName: string | null;
  geocoded: boolean;
}

// Import types

export type ImportIssueLevel = 'info' | 'warning' | 'error';

export interface ImportIssue {
  rowNumber: number;
  level: ImportIssueLevel;
  field: string;
  message: string;
  originalValue?: string;
}

export interface ImportReport {
  filename: string;
  importedAt: string;
  durationMs: number;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  issues: ImportIssue[];
}

export interface CsvCustomerRow {
  type?: string;
  name?: string;
  contactPerson?: string;
  ico?: string;
  dic?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface ImportBatchRequest {
  customers: CreateCustomerRequest[];
}

export interface ImportBatchResponse {
  importedCount: number;
  updatedCount: number;
  errors: ImportIssue[];
}
