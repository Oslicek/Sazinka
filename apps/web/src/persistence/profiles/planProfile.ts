/**
 * Plan page persistence profile.
 *
 * Controls (7):
 *  - dateFrom: date string (URL: date — single date mode)
 *  - dateTo: date string (URL: dateTo — range end, not currently URL-persisted)
 *  - isDateRange: boolean — false by default on Plan (C34)
 *  - crew: crew id (URL: crew)
 *  - depot: depot id (URL: depot)
 *  - selectedRouteId: UUID string | null — last selected route (P1-1)
 *  - timelineView: 'planning' | 'compact' | 'route' — last active view mode (P3-2)
 *
 * Layout preferences (deferred — managed by existing localStorage):
 *  - sidebarWidth: deferred
 *  - routeListHeight: deferred
 */
import type { PersistenceProfile } from '../core/types';

export const PLAN_PROFILE_ID = 'plan.filters';

export const TIMELINE_VIEWS = ['planning', 'compact', 'route'] as const;

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
    {
      controlId: 'selectedRouteId',
      pluginId: 'json',
      defaultValue: null,
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'timelineView',
      pluginId: 'enum',
      defaultValue: 'planning',
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['url', 'session', 'local'],
  writeTargets: ['session'],
};
