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

export const REVISION_STATUS_LABELS: Record<RevisionDisplayStatus, string> = {
  upcoming: 'Plánovaná',
  due_soon: 'Brzy',
  overdue: 'Po termínu',
  scheduled: 'Naplánováno',
  confirmed: 'Potvrzeno',
  completed: 'Dokončeno',
  cancelled: 'Zrušeno',
};

export type RevisionResult = 'passed' | 'failed' | 'conditional';

export const REVISION_RESULT_LABELS: Record<RevisionResult, string> = {
  passed: 'V pořádku',
  failed: 'Nevyhovělo',
  conditional: 'S výhradami',
};

export interface TimeWindow {
  start: string; // HH:MM format
  end: string;
  isHard: boolean;
}
