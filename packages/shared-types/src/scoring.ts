// Scoring rule set types — shared between frontend and backend

export interface ScoringRuleSet {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isArchived: boolean;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoringRuleFactor {
  ruleSetId: string;
  factorKey: string;
  weight: number;
}

export interface FactorInput {
  factorKey: string;
  weight: number;
}

export interface CreateScoringRuleSetRequest {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  factors?: FactorInput[];
}

export interface UpdateScoringRuleSetRequest {
  id: string;
  name?: string | null;
  description?: string | null;
  isDefault?: boolean | null;
  factors?: FactorInput[] | null;
}

export interface DispatcherInboxState {
  userId: string;
  selectedRuleSetId: string | null;
  sortMode: string;
  activeFiltersJson: unknown;
  pageNumber: number;
  pageSize: number;
  updatedAt: string;
}

export interface SaveInboxStateRequest {
  selectedRuleSetId?: string | null;
  sortMode?: string | null;
  activeFiltersJson?: unknown;
  pageNumber?: number | null;
  pageSize?: number | null;
}

/** Known factor keys for urgency scoring */
export const FACTOR_KEYS = {
  OVERDUE_DAYS: 'overdue_days',
  GEOCODE_FAILED: 'geocode_failed',
  TOTAL_COMMUNICATIONS: 'total_communications',
  DAYS_SINCE_LAST_CONTACT: 'days_since_last_contact',
  NO_OPEN_ACTION: 'no_open_action',
} as const;

export type FactorKey = (typeof FACTOR_KEYS)[keyof typeof FACTOR_KEYS];
