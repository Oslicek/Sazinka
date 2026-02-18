// Device Type Configuration types

// ============================================================================
// Field types
// ============================================================================

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';

// ============================================================================
// Entities
// ============================================================================

export interface SelectOption {
  key: string;
  label: string;
  deprecated?: boolean;
}

export interface DeviceTypeField {
  id: string;
  deviceTypeConfigId: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  isRequired: boolean;
  selectOptions?: SelectOption[];
  defaultValue?: string;
  sortOrder: number;
  unit?: string;
  placeholder?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceTypeConfig {
  id: string;
  tenantId: string;
  deviceTypeKey: string;
  label: string;
  icon?: string;
  isActive: boolean;
  isBuiltin: boolean;
  defaultRevisionDurationMinutes: number;
  defaultRevisionIntervalMonths: number;
  sortOrder: number;
  fields: DeviceTypeField[];
  createdAt: string;
  updatedAt: string;
}

/** Lightweight version without fields, used in lists */
export interface DeviceTypeConfigSummary {
  id: string;
  tenantId: string;
  deviceTypeKey: string;
  label: string;
  icon?: string;
  isActive: boolean;
  isBuiltin: boolean;
  defaultRevisionDurationMinutes: number;
  defaultRevisionIntervalMonths: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Custom field value (stored per device)
// ============================================================================

export interface DeviceFieldValue {
  fieldId: string;
  fieldKey: string;
  value: string | number | boolean | null;
}

// ============================================================================
// API Request types
// ============================================================================

// --- Device Type Config ---

export interface ListDeviceTypeConfigsRequest {
  includeInactive?: boolean;
}

export interface GetDeviceTypeConfigRequest {
  id: string;
}

export interface UpdateDeviceTypeConfigRequest {
  id: string;
  label?: string;
  isActive?: boolean;
  defaultRevisionDurationMinutes?: number;
  defaultRevisionIntervalMonths?: number;
  sortOrder?: number;
}

// --- Device Type Field ---

export interface CreateDeviceTypeFieldRequest {
  deviceTypeConfigId: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  isRequired?: boolean;
  selectOptions?: SelectOption[];
  defaultValue?: string;
  unit?: string;
  placeholder?: string;
}

export interface UpdateDeviceTypeFieldRequest {
  id: string;
  label?: string;
  isRequired?: boolean;
  defaultValue?: string;
  selectOptions?: SelectOption[];
  unit?: string;
  placeholder?: string;
}

export interface SetFieldActiveRequest {
  id: string;
  isActive: boolean;
}

export interface ReorderFieldsRequest {
  deviceTypeConfigId: string;
  fieldIds: string[];
}

// ============================================================================
// API Response types
// ============================================================================

export interface DeviceTypeConfigListResponse {
  items: DeviceTypeConfigSummary[];
}

export interface DeviceTypeConfigDetailResponse extends DeviceTypeConfig {}
