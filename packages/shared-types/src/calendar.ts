// Unified calendar item types for Calendar/Dashboard views

export type CalendarItemType = 'revision' | 'visit' | 'task';

export type CalendarItemStatus =
  | 'scheduled'
  | 'due'
  | 'overdue'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'pending';

export type CalendarItemPriority = 'low' | 'medium' | 'high';

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  date: string; // YYYY-MM-DD
  status: CalendarItemStatus;
  title: string;
  subtitle?: string;
  timeStart?: string | null;
  timeEnd?: string | null;
  customerId?: string;
  customerName?: string;
  deviceId?: string;
  deviceType?: string;
  crewId?: string | null;
  sourceStatus?: string | null;
  sourceType?: string | null;
  priority?: CalendarItemPriority;
}
