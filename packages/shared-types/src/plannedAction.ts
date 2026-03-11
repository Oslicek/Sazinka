// Planned action types — scheduling layer for any future customer interaction

export type ActionStatus = 'open' | 'completed' | 'cancelled' | 'snoozed';

export type ActionTargetKind = 'task' | 'visit' | 'project' | 'other';

export interface PlannedAction {
  id: string;
  userId: string;
  customerId: string;
  status: ActionStatus;
  dueDate: string;           // ISO date (YYYY-MM-DD)
  snoozeUntil: string | null;
  snoozeReason: string | null;
  actionTargetId: string | null;
  // Legacy transitional links (Phase 1-4)
  revisionId: string | null;
  visitId: string | null;
  deviceId: string | null;
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlannedActionRequest {
  customerId: string;
  dueDate: string;
  note?: string;
  snoozeUntil?: string;
  snoozeReason?: string;
  actionTargetId?: string;
  // Legacy links
  revisionId?: string;
  visitId?: string;
  deviceId?: string;
}

export interface UpdatePlannedActionRequest {
  id: string;
  status?: ActionStatus;
  dueDate?: string;
  note?: string;
  snoozeUntil?: string | null;
  snoozeReason?: string | null;
}

export interface ListPlannedActionsRequest {
  customerId?: string;
  status?: ActionStatus;
  limit?: number;
  offset?: number;
}

export interface PlannedActionListResponse {
  items: PlannedAction[];
  total: number;
}
