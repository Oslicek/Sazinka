// Revision types

export interface Revision {
  id: string;
  deviceId: string;
  customerId: string;
  userId: string;
  status: RevisionStatus;
  dueDate: string;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  completedAt?: string;
  durationMinutes?: number;
  result?: RevisionResult;
  findings?: string;
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

export type RevisionStatus =
  | 'upcoming'
  | 'due_soon'
  | 'overdue'
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled';

export const REVISION_STATUS_LABELS: Record<RevisionStatus, string> = {
  upcoming: 'Nadcházející',
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
