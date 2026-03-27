// Visit types for CRM

export type VisitStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'rescheduled';
export type VisitType = 'revision' | 'installation' | 'repair' | 'consultation' | 'follow_up';
export type VisitResult = 'successful' | 'partial' | 'failed' | 'customer_absent' | 'rescheduled';

export interface Visit {
  id: string;
  userId: string;
  customerId: string;
  crewId?: string | null;
  deviceId?: string | null;

  // Scheduling
  scheduledDate: string;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;

  // Status
  status: VisitStatus;
  visitType: VisitType;

  // Actual times
  actualArrival?: string | null;
  actualDeparture?: string | null;

  // Result
  result?: VisitResult | null;
  /** Rich-text field notes in Markdown (replaces legacy resultNotes) */
  fieldNotes?: string | null;

  // Follow-up
  requiresFollowUp: boolean;
  followUpReason?: string | null;

  // Timestamps
  createdAt: string;
  updatedAt: string;

  // Joined data (optional, filled by backend)
  customerName?: string;
  customerStreet?: string;
  customerCity?: string;
}

export interface CreateVisitRequest {
  customerId: string;
  crewId?: string;
  deviceId?: string;
  scheduledDate: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  visitType: VisitType;
  status?: VisitStatus;
}

export interface UpdateVisitRequest {
  id: string;
  scheduledDate?: string;
  scheduledTimeStart?: string | null;
  scheduledTimeEnd?: string | null;
  status?: VisitStatus;
  visitType?: VisitType;
}

export interface CompleteVisitRequest {
  id: string;
  result: VisitResult;
  actualArrival?: string;
  actualDeparture?: string;
  /** Optional final note state to persist atomically with completion */
  fieldNotes?: string;
  /** Browser-tab session id for audit upsert */
  sessionId?: string;
  requiresFollowUp?: boolean;
  followUpReason?: string;
}

export interface UpdateFieldNotesRequest {
  visitId: string;
  /** Browser-tab session id (UUID v4) */
  sessionId: string;
  /** Markdown content, max 10,000 chars */
  fieldNotes: string;
}

export interface ListNotesHistoryRequest {
  visitId: string;
}

export interface NotesHistoryEntry {
  id: string;
  sessionId: string;
  editedByUserId: string;
  editedByName?: string | null;
  fieldNotes: string;
  firstEditedAt: string;
  lastEditedAt: string;
  changeCount: number;
}

export interface ListNotesHistoryResponse {
  entries: NotesHistoryEntry[];
}

export interface ListVisitsRequest {
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: VisitStatus;
  visitType?: VisitType;
  limit?: number;
  offset?: number;
}

export interface ListVisitsResponse {
  visits: Visit[];
  total: number;
}

export interface GetVisitResponse {
  visit: Visit;
  customerName?: string | null;
  customerStreet?: string | null;
  customerCity?: string | null;
  customerPostalCode?: string | null;
  customerPhone?: string | null;
  customerLat?: number | null;
  customerLng?: number | null;
  workItems: import('./workItem').VisitWorkItem[];
}
