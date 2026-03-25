/**
 * Inbox UI state persistence profile.
 *
 * Controls:
 *  - isAdvancedFiltersOpen: boolean — advanced filter panel expanded state
 */
import type { PersistenceProfile } from '../core/types';

export const INBOX_UI_PROFILE_ID = 'inbox.ui';

export const inboxUiProfile: PersistenceProfile = {
  profileId: INBOX_UI_PROFILE_ID,
  controls: [
    {
      controlId: 'isAdvancedFiltersOpen',
      pluginId: 'json',
      defaultValue: false,
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['session'],
  writeTargets: ['session'],
};
