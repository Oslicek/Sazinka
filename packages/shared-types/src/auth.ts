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

/** Phase 10: New registration flow with email verification */
export interface RegisterStartRequest {
  email: string;
  password: string;
  locale: string;
  country: string;
}

/** Phase 10: Generic success returned by register.start (anti-enumeration) */
export interface RegisterStartResponse {
  ok: true;
  message: string;
}

/** Phase 10: Verify email token after clicking link */
export interface VerifyEmailRequest {
  token: string;
}

/** Phase 10: Resend verification email */
export interface ResendVerificationRequest {
  email: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'customer' | 'worker';
  phone?: string;
  businessName?: string;
  permissions?: string[];
  /** BCP-47 locale code (e.g. 'en', 'cs', 'en-GB'). Default: 'en'. */
  locale: string;
  emailVerified: boolean;
  onboardingCompletedAt?: string;
  onboardingStep: number;
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
  roleIds?: string[];
}

export interface DeleteWorkerRequest {
  id: string;
}

// ── RBAC types ──

export interface RoleWithPermissions {
  id: string;
  ownerID: string;
  name: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleAssignment {
  roleId: string;
  name: string;
}

// ── Permission constants ──

export const PAGE_PERMISSIONS = [
  { key: 'page:calendar', labelKey: 'settings:perm_page_calendar' },
  { key: 'page:inbox', labelKey: 'settings:perm_page_inbox' },
  { key: 'page:planner', labelKey: 'settings:perm_page_planner' },
  { key: 'page:worklog', labelKey: 'settings:perm_page_worklog' },
  { key: 'page:customers', labelKey: 'settings:perm_page_customers' },
  { key: 'page:routes', labelKey: 'settings:perm_page_routes' },
  { key: 'page:jobs', labelKey: 'settings:perm_page_jobs' },
  { key: 'page:settings', labelKey: 'settings:perm_page_settings' },
  { key: 'page:about', labelKey: 'settings:perm_page_about' },
] as const;

export const SETTINGS_PERMISSIONS = [
  { key: 'settings:preferences', labelKey: 'settings:perm_settings_preferences' },
  { key: 'settings:work', labelKey: 'settings:perm_settings_work' },
  { key: 'settings:business', labelKey: 'settings:perm_settings_business' },
  { key: 'settings:email', labelKey: 'settings:perm_settings_email' },
  { key: 'settings:breaks', labelKey: 'settings:perm_settings_breaks' },
  { key: 'settings:depots', labelKey: 'settings:perm_settings_depots' },
  { key: 'settings:crews', labelKey: 'settings:perm_settings_crews' },
  { key: 'settings:workers', labelKey: 'settings:perm_settings_workers' },
  { key: 'settings:import-export', labelKey: 'settings:perm_settings_import_export' },
  { key: 'settings:roles', labelKey: 'settings:perm_settings_roles' },
  { key: 'settings:devices', labelKey: 'settings:perm_settings_devices' },
] as const;

export const ALL_PERMISSIONS = [
  ...PAGE_PERMISSIONS,
  ...SETTINGS_PERMISSIONS,
] as const;
