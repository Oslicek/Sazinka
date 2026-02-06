// Work item types - represents work performed during a visit

export type WorkType = 'revision' | 'repair' | 'installation' | 'consultation' | 'follow_up';
export type WorkResult = 'successful' | 'partial' | 'failed' | 'customer_absent' | 'rescheduled';

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  revision: 'Revize',
  repair: 'Oprava',
  installation: 'Instalace',
  consultation: 'Konzultace',
  follow_up: 'Následná kontrola',
};

export const WORK_RESULT_LABELS: Record<WorkResult, string> = {
  successful: 'Úspěšná',
  partial: 'Částečná',
  failed: 'Neúspěšná',
  customer_absent: 'Nepřítomen',
  rescheduled: 'Přeplánováno',
};

export interface VisitWorkItem {
  id: string;
  visitId: string;
  deviceId?: string | null;
  revisionId?: string | null;
  crewId?: string | null;
  workType: WorkType;
  durationMinutes?: number | null;
  result?: WorkResult | null;
  resultNotes?: string | null;
  findings?: string | null;
  requiresFollowUp: boolean;
  followUpReason?: string | null;
  createdAt: string;
}

export interface CreateWorkItemRequest {
  visitId: string;
  deviceId?: string;
  revisionId?: string;
  crewId?: string;
  workType: WorkType;
  durationMinutes?: number;
  result?: WorkResult;
  resultNotes?: string;
  findings?: string;
  requiresFollowUp?: boolean;
  followUpReason?: string;
}

export interface CompleteWorkItemRequest {
  id: string;
  result: WorkResult;
  durationMinutes?: number;
  resultNotes?: string;
  findings?: string;
  requiresFollowUp?: boolean;
  followUpReason?: string;
}

export interface ListWorkItemsRequest {
  visitId?: string;
  revisionId?: string;
  deviceId?: string;
}

export interface ListWorkItemsResponse {
  items: VisitWorkItem[];
  total: number;
}
