/**
 * Routes page persistence profile.
 *
 * Controls (5):
 *  - dateFrom: date string (URL: dateFrom)
 *  - dateTo: date string (URL: dateTo)
 *  - isDateRange: boolean — true means date range mode (not currently URL-persisted)
 *  - crew: crew id (URL: crew)
 *  - depot: depot id (URL: depot)
 */
import type { PersistenceProfile } from '../core/types';

export const ROUTES_PROFILE_ID = 'routes.filters';

export const routesProfile: PersistenceProfile = {
  profileId: ROUTES_PROFILE_ID,
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
      defaultValue: true,
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
