/**
 * Plan page persistence profile (filters only).
 *
 * Controls (5):
 *  - dateFrom: date string (URL: date — single date mode)
 *  - dateTo: date string (URL: dateTo — range end, not currently URL-persisted)
 *  - isDateRange: boolean — false by default on Plan (C34)
 *  - crew: crew id (URL: crew)
 *  - depot: depot id (URL: depot)
 *
 * Layout preferences (deferred — managed by existing localStorage):
 *  - sidebarWidth: deferred
 *  - routeListHeight: deferred
 *  - timelineView: 'planning' | 'route' — added to UPP profile
 */
import type { PersistenceProfile } from '../core/types';

export const PLAN_PROFILE_ID = 'plan.filters';

export const planProfile: PersistenceProfile = {
  profileId: PLAN_PROFILE_ID,
  controls: [
    {
      controlId: 'dateFrom',
      pluginId: 'date',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'dateTo',
      pluginId: 'date',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'isDateRange',
      pluginId: 'boolean',
      defaultValue: false,
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'crew',
      pluginId: 'text',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'depot',
      pluginId: 'text',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['url', 'session', 'local'],
  writeTargets: ['session'],
};
