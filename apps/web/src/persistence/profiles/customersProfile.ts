/**
 * Customers page persistence profile.
 *
 * Controls (7):
 *  - search: text input (debounced, not in URL currently)
 *  - viewMode: 'table' | 'cards' (URL: view)
 *  - geocodeFilter: GeocodeStatus | '' (URL: geocodeStatus)
 *  - revisionFilter: '' | 'overdue' | 'week' | 'month' (URL: revision — replaces lossy hasOverdue boolean)
 *  - typeFilter: 'company' | 'person' | '' (not in URL currently)
 *  - sortBy: ListCustomersRequest['sortBy'] (URL: sortBy)
 *  - sortOrder: 'asc' | 'desc' (URL: sortOrder)
 */
import type { PersistenceProfile } from '../core/types';

export const CUSTOMERS_PROFILE_ID = 'customers.filters';

export const customersProfile: PersistenceProfile = {
  profileId: CUSTOMERS_PROFILE_ID,
  controls: [
    {
      controlId: 'search',
      pluginId: 'text',
      defaultValue: '',
      writeMode: 'debounced',
      debounceMs: 300,
      validators: [],
    },
    {
      controlId: 'viewMode',
      pluginId: 'enum',
      defaultValue: 'table',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'geocodeFilter',
      pluginId: 'enum',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'revisionFilter',
      pluginId: 'enum',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'typeFilter',
      pluginId: 'enum',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'sortBy',
      pluginId: 'enum',
      defaultValue: 'name',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'sortOrder',
      pluginId: 'enum',
      defaultValue: 'asc',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'selectedCustomerId',
      pluginId: 'json',
      defaultValue: null,
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['url', 'session', 'local'],
  writeTargets: ['session'],
};
