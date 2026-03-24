/**
 * PlanningInbox break rule persistence profile.
 *
 * Controls:
 *  - enforceDrivingBreakRule: boolean — local storage only
 *
 * Separate from inboxFiltersProfile to ensure channel isolation:
 * filters → session, enforceDrivingBreakRule → local.
 */
import type { PersistenceProfile } from '../core/types';

export const INBOX_BREAK_RULE_PROFILE_ID = 'inbox.breakRule';

export const inboxBreakRuleProfile: PersistenceProfile = {
  profileId: INBOX_BREAK_RULE_PROFILE_ID,
  controls: [
    {
      controlId: 'enforceDrivingBreakRule',
      pluginId: 'boolean',
      defaultValue: true,
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['local'],
  writeTargets: ['local'],
};
