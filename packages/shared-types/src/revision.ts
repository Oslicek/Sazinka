// Revision types

export interface Revision {
  id: string;
  deviceId: string;
  customerId: string;
  userId: string;
  status: RevisionStatus;
  dueDate: string;
  scheduledDate?: string | null;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
  completedAt?: string | null;
  durationMinutes?: number | null;
  result?: RevisionResult | null;
  findings?: string | null;
  fulfilledByWorkItemId?: string | null;
  snoozeUntil?: string | null;
  snoozeReason?: string | null;
  assignedCrewId?: string | null;
  routeOrder?: number | null;
  createdAt: string;
  updatedAt: string;
  // Device info (joined from devices table)
  deviceName?: string;
  deviceType?: string;
  // Customer info (joined from customers table)
  customerName?: string;
  customerPhone?: string;
  customerStreet?: string;
  customerCity?: string;
  customerPostalCode?: string;
}

/** Status values stored in the database */
export type RevisionStatus =
  | 'upcoming'
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled';

/** Extended status including computed display states (not stored in DB) */
export type RevisionDisplayStatus = RevisionStatus | 'due_soon' | 'overdue';

/** i18n translation keys for revision display statuses */
export const REVISION_STATUS_KEYS: Record<RevisionDisplayStatus, string> = {
  upcoming: 'common:revision_status.upcoming',
  due_soon: 'common:revision_status.due_soon',
  overdue: 'common:revision_status.overdue',
  scheduled: 'common:revision_status.scheduled',
  confirmed: 'common:revision_status.confirmed',
  completed: 'common:revision_status.completed',
  cancelled: 'common:revision_status.cancelled',
};

export type RevisionResult = 'passed' | 'failed' | 'conditional';

/** i18n translation keys for revision results */
export const REVISION_RESULT_KEYS: Record<RevisionResult, string> = {
  passed: 'common:revision_result.passed',
  failed: 'common:revision_result.failed',
  conditional: 'common:revision_result.conditional',
};

export interface TimeWindow {
  start: string; // HH:MM format
  end: string;
  isHard: boolean;
}
