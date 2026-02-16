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
  /** Company-level locale for emails and external communication (e.g. "en", "cs"). */
  companyLocale: string;
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
  /** When confirmation template was last manually edited (ISO 8601). Null = using defaults. */
  confirmationEditedAt: string | null;
  /** When reminder template was last manually edited (ISO 8601). Null = using defaults. */
  reminderEditedAt: string | null;
  /** When third template was last manually edited (ISO 8601). Null = using defaults. */
  thirdEditedAt: string | null;
}

// Combined user settings
export interface UserPreferences {
  defaultCrewId: string | null;
  defaultDepotId: string | null;
  /** BCP-47 locale code (e.g. "en", "cs", "en-GB"). */
  locale: string;
  /** Last-used arrival buffer percentage (auto-filled into new routes). */
  lastArrivalBufferPercent: number;
  /** Last-used fixed arrival buffer in minutes (auto-filled into new routes). */
  lastArrivalBufferFixedMinutes: number;
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
  email?: string;
  phone?: string;
  businessName?: string;
  ico?: string;
  dic?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  /** Company-level locale for emails and external communication (e.g. "en", "cs"). */
  companyLocale?: string;
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

export interface UpdatePreferencesRequest {
  defaultCrewId: string | null;
  defaultDepotId: string | null;
  locale: string;
}

// List depots response
export interface ListDepotsResponse {
  depots: Depot[];
}
