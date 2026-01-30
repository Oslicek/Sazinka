// Communication types for CRM

export type CommunicationType = 'email_sent' | 'email_received' | 'call' | 'note' | 'sms';
export type CommunicationDirection = 'outbound' | 'inbound';
export type EmailStatus = 'sent' | 'delivered' | 'opened' | 'bounced' | 'failed';

export interface Communication {
  id: string;
  userId: string;
  customerId: string;
  revisionId?: string | null;
  
  commType: CommunicationType;
  direction: CommunicationDirection;
  
  subject?: string | null;
  content: string;
  
  contactName?: string | null;
  contactPhone?: string | null;
  
  emailStatus?: EmailStatus | null;
  durationMinutes?: number | null;
  
  followUpDate?: string | null;
  followUpCompleted: boolean;
  
  createdAt: string;
}

export interface CreateCommunicationRequest {
  customerId: string;
  revisionId?: string;
  commType: CommunicationType;
  direction: CommunicationDirection;
  subject?: string;
  content: string;
  contactName?: string;
  contactPhone?: string;
  durationMinutes?: number;
  followUpDate?: string;
}

export interface UpdateCommunicationRequest {
  id: string;
  subject?: string;
  content?: string;
  followUpDate?: string | null;
  followUpCompleted?: boolean;
}

export interface ListCommunicationsRequest {
  customerId?: string;
  revisionId?: string;
  commType?: CommunicationType;
  followUpPending?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListCommunicationsResponse {
  communications: Communication[];
  total: number;
}
