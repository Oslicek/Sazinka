// Settings and Depot types

export interface Depot {
  id: string;
  userId: string;
  name: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country: string;
  lat: number;
  lng: number;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDepotRequest {
  name: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  lat: number;
  lng: number;
  isPrimary?: boolean;
}

export interface UpdateDepotRequest {
  id: string;
  name?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  lat?: number;
  lng?: number;
  isPrimary?: boolean;
}

export interface DeleteDepotRequest {
  id: string;
}

// Work constraints
export interface WorkConstraints {
  workingHoursStart: string; // "08:00"
  workingHoursEnd: string;   // "17:00"
  maxRevisionsPerDay: number;
  defaultServiceDurationMinutes: number;
  defaultRevisionIntervalMonths: number;
  reminderDaysBefore: number[];
}

// Business/Personal info
export interface BusinessInfo {
  name: string;
  email: string;
  phone?: string;
  businessName?: string;
  ico?: string;
  dic?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

// Email template settings
export interface EmailTemplateSettings {
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
}

// Combined user settings
export interface UserSettings {
  // Work constraints
  workConstraints: WorkConstraints;
  // Business info
  businessInfo: BusinessInfo;
  // Email templates
  emailTemplates: EmailTemplateSettings;
  // Depots
  depots: Depot[];
}

// Update requests
export interface UpdateWorkConstraintsRequest {
  workingHoursStart?: string;
  workingHoursEnd?: string;
  maxRevisionsPerDay?: number;
  defaultServiceDurationMinutes?: number;
  defaultRevisionIntervalMonths?: number;
  reminderDaysBefore?: number[];
}

export interface UpdateBusinessInfoRequest {
  name?: string;
  phone?: string;
  businessName?: string;
  ico?: string;
  dic?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export interface UpdateEmailTemplatesRequest {
  emailSubjectTemplate?: string;
  emailBodyTemplate?: string;
}

// List depots response
export interface ListDepotsResponse {
  depots: Depot[];
}
