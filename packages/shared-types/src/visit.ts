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
  resultNotes?: string | null;
  
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
  resultNotes?: string;
  actualArrival?: string;
  actualDeparture?: string;
  requiresFollowUp?: boolean;
  followUpReason?: string;
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
