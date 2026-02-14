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

// Break/pause settings
export interface BreakSettings {
  breakEnabled: boolean;
  breakDurationMinutes: number;
  breakEarliestTime: string;   // "HH:MM"
  breakLatestTime: string;     // "HH:MM"
  breakMinKm: number;
  breakMaxKm: number;
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
  confirmationSubjectTemplate: string;
  confirmationBodyTemplate: string;
  reminderSubjectTemplate: string;
  reminderBodyTemplate: string;
  reminderSendTime: string; // "HH:MM"
  thirdSubjectTemplate: string;
  thirdBodyTemplate: string;
}

// Combined user settings
export interface UserPreferences {
  defaultCrewId: string | null;
  defaultDepotId: string | null;
}

export interface UserSettings {
  // Work constraints
  workConstraints: WorkConstraints;
  // Business info
  businessInfo: BusinessInfo;
  // Email templates
  emailTemplates: EmailTemplateSettings;
  // Depots
  depots: Depot[];
  // User preferences (default crew/depot)
  preferences: UserPreferences;
  // Break settings
  breakSettings: BreakSettings;
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
  confirmationSubjectTemplate?: string;
  confirmationBodyTemplate?: string;
  reminderSubjectTemplate?: string;
  reminderBodyTemplate?: string;
  reminderSendTime?: string;
  thirdSubjectTemplate?: string;
  thirdBodyTemplate?: string;
}

export interface UpdateBreakSettingsRequest {
  breakEnabled?: boolean;
  breakDurationMinutes?: number;
  breakEarliestTime?: string;
  breakLatestTime?: string;
  breakMinKm?: number;
  breakMaxKm?: number;
}

// List depots response
export interface ListDepotsResponse {
  depots: Depot[];
}
