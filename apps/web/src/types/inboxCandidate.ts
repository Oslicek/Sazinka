/**
 * InboxCandidate - A revision candidate for scheduling
 * 
 * Used in PlanningInbox and AddFromInboxDrawer
 */

export interface InboxCandidate {
  id: string;
  customerId: string;
  customerName: string;
  deviceId: string;
  deviceName: string;
  deviceType: string;
  dueDate: string;
  priority: string;
  lat: number;
  lng: number;
  status: string;
  snoozedUntil: string | null;
}
