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
  permissions?: string[];
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
  { key: 'page:calendar', label: 'Kalendar' },
  { key: 'page:inbox', label: 'Inbox' },
  { key: 'page:planner', label: 'Plan' },
  { key: 'page:worklog', label: 'Zaznam' },
  { key: 'page:customers', label: 'Zakaznici' },
  { key: 'page:routes', label: 'Trasy' },
  { key: 'page:jobs', label: 'Ulohy' },
  { key: 'page:settings', label: 'Nastaveni' },
  { key: 'page:about', label: 'O sluzbe' },
] as const;

export const SETTINGS_PERMISSIONS = [
  { key: 'settings:preferences', label: 'Moje nastaveni' },
  { key: 'settings:work', label: 'Pracovni doba' },
  { key: 'settings:business', label: 'Firemni udaje' },
  { key: 'settings:email', label: 'E-mailove sablony' },
  { key: 'settings:breaks', label: 'Pauzy' },
  { key: 'settings:depots', label: 'Depa' },
  { key: 'settings:crews', label: 'Posadky' },
  { key: 'settings:workers', label: 'Pracovnici' },
  { key: 'settings:import-export', label: 'Import & Export' },
  { key: 'settings:roles', label: 'Sprava roli' },
] as const;

export const ALL_PERMISSIONS = [
  ...PAGE_PERMISSIONS,
  ...SETTINGS_PERMISSIONS,
] as const;
