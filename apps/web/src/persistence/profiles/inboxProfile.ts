/**
 * PlanningInbox persistence profile.
 *
 * Controls (4):
 *  - filters: JSON object (sessionStorage: planningInbox.filters)
 *  - context: JSON object (sessionStorage: planningInbox.context)
 *  - selectedId: string (sessionStorage: planningInbox.selectedId)
 *  - enforceDrivingBreakRule: boolean (localStorage: planningInbox.enforceDrivingBreakRule)
 *
 * Legacy compatibility:
 *  - All 4 legacy keys are preserved during migration (dual-read/dual-write).
 *  - sazinka.snooze.defaultDays is deferred (not migrated to UPP).
 *
 * CRITICAL: The route persistence behavior (context, selectedId) must NOT change.
 * These controls are read-only in the UPP profile — the page continues to write
 * them directly via sessionStorage for now (dual-write window).
 */
import type { PersistenceProfile } from '../core/types';

export const INBOX_PROFILE_ID = 'inbox.state';

export const inboxProfile: PersistenceProfile = {
  profileId: INBOX_PROFILE_ID,
  controls: [
    {
      controlId: 'filters',
      pluginId: 'json',
      defaultValue: null,
      writeMode: 'immediate',
      validators: [],
      legacyKeys: ['planningInbox.filters'],
    },
    {
      controlId: 'context',
      pluginId: 'json',
      defaultValue: null,
      writeMode: 'immediate',
      validators: [],
      legacyKeys: ['planningInbox.context'],
    },
    {
      controlId: 'selectedId',
      pluginId: 'text',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
      legacyKeys: ['planningInbox.selectedId'],
    },
    {
      controlId: 'enforceDrivingBreakRule',
      pluginId: 'boolean',
      defaultValue: true,
      writeMode: 'immediate',
      validators: [],
      legacyKeys: ['planningInbox.enforceDrivingBreakRule'],
    },
  ],
  readPriority: ['session', 'local'],
  writeTargets: ['session'],
};
