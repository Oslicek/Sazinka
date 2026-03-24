/**
 * PlanningInbox filters persistence profile.
 *
 * Controls:
 *  - filters: JSON object (InboxFilterExpression) — session only
 *
 * CRITICAL: planningInbox.context and planningInbox.selectedId are NOT in this profile.
 * They remain as direct sessionStorage operations in PlanningInbox.tsx.
 */
import type { PersistenceProfile } from '../core/types';

export const INBOX_FILTERS_PROFILE_ID = 'inbox.filters';

export const inboxFiltersProfile: PersistenceProfile = {
  profileId: INBOX_FILTERS_PROFILE_ID,
  controls: [
    {
      controlId: 'filters',
      pluginId: 'json',
      defaultValue: null,
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['session'],
  writeTargets: ['session'],
};
