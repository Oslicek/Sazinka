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

// ============================================================================
// Extended Customer Types for List Views
// ============================================================================

/**
 * Customer list item with aggregated data (device count, next revision, etc.)
 */
export interface CustomerListItem {
  id: string;
  userId: string;
  type: CustomerType;
  name: string;
  email?: string;
  phone?: string;
  street: string;
  city: string;
  postalCode: string;
  lat?: number;
  lng?: number;
  geocodeStatus: GeocodeStatus;
  createdAt: string;
  
  // Aggregated fields
  deviceCount: number;
  nextRevisionDate: string | null;
  overdueCount: number;
}

/**
 * Request for listing customers with filters and sorting
 */
export interface ListCustomersRequest {
  limit?: number;
  offset?: number;
  search?: string;
  /** Filter by geocode status */
  geocodeStatus?: GeocodeStatus;
  /** Filter to customers with overdue revisions */
  hasOverdue?: boolean;
  /** Filter to customers with next revision within N days */
  nextRevisionWithinDays?: number;
  /** Filter by customer type */
  customerType?: CustomerType;
  /** Sort by field */
  sortBy?: 'name' | 'nextRevision' | 'deviceCount' | 'city' | 'createdAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Response for customer list with pagination
 */
export interface CustomerListResponse {
  items: CustomerListItem[];
  total: number;
}

/**
 * Customer summary statistics
 */
export interface CustomerSummary {
  totalCustomers: number;
  totalDevices: number;
  revisionsOverdue: number;
  revisionsDueThisWeek: number;
  revisionsScheduled: number;
  geocodeSuccess: number;
  geocodePending: number;
  geocodeFailed: number;
  customersWithoutPhone: number;
  customersWithoutEmail: number;
}
