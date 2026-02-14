// Work item types - represents work performed during a visit

export type WorkType = 'revision' | 'repair' | 'installation' | 'consultation' | 'follow_up';
export type WorkResult = 'successful' | 'partial' | 'failed' | 'customer_absent' | 'rescheduled';

/** i18n translation keys for work types */
export const WORK_TYPE_KEYS: Record<WorkType, string> = {
  revision: 'common:work_type.revision',
  repair: 'common:work_type.repair',
  installation: 'common:work_type.installation',
  consultation: 'common:work_type.consultation',
  follow_up: 'common:work_type.follow_up',
};

/** i18n translation keys for work results */
export const WORK_RESULT_KEYS: Record<WorkResult, string> = {
  successful: 'common:work_result.successful',
  partial: 'common:work_result.partial',
  failed: 'common:work_result.failed',
  customer_absent: 'common:work_result.customer_absent',
  rescheduled: 'common:work_result.rescheduled',
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
