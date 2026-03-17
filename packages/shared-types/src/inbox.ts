// Inbox types — customer-centric planning inbox

import type { ScoreBreakdownItem } from './scoring';

export type LifecycleState = 'untouched' | 'active' | 'needs_action' | 'abandoned' | 'deleted';

export type InboxSortMode = 'rank_first' | 'due_date';

/**
 * A single customer row in the planning inbox.
 * Replaces the revision-centric InboxCandidate / CallQueueItem shape.
 */
export interface InboxItem {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  geocodeStatus: string;
  customerCreatedAt: string;

  // Lifecycle
  lifecycleState: LifecycleState;
  lifecycleRank: number;  // 0=untouched, 1=overdue, 2=upcoming, 3=needs_action

  // Next action (null for untouched/needs_action)
  nextActionKind: string | null;
  nextActionLabelKey: string | null;
  nextActionLabelFallback: string | null;
  nextActionDue: string | null;
  nextActionNote: string | null;

  // Contact history
  totalCommunications: number;
  lastContactAt: string | null;

  // Urgency scoring (Phase 4+; 0 when scoring disabled)
  urgencyScore: number;
  /** Per-factor breakdown for the score explanation UI */
  scoreBreakdown?: ScoreBreakdownItem[];

  // Legacy device info (Phase 2-4; removed in Phase 6)
  deviceId?: string | null;
  deviceName?: string | null;
  deviceType?: string | null;
}

export interface InboxRequest {
  limit?: number;
  offset?: number;
  sortMode?: InboxSortMode;
  selectedRuleSetId?: string | null;
  // Filters
  lifecycleFilter?: LifecycleState[];
  geocodedOnly?: boolean;
  areaFilter?: string;
}

export interface InboxResponse {
  items: InboxItem[];
  total: number;
  overdueCount: number;
  dueSoonCount: number;
}
