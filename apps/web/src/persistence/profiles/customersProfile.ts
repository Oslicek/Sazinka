/**
 * Customers page persistence profile (session-scoped).
 *
 * Controls (6):
 *  - search: text input (debounced)
 *  - viewMode: 'table' | 'cards'
 *  - geocodeFilter: GeocodeStatus | ''
 *  - revisionFilter: '' | 'overdue' | 'week' | 'month'
 *  - typeFilter: 'company' | 'person' | ''
 *  - selectedCustomerId: UUID string | null — last selected customer
 *
 * NOTE: sortBy/sortOrder were removed in Phase 1C.
 * Sorting now lives in customers.grid (local) as sortModel.
 * Phase 4B will add isAdvancedFiltersOpen as a 7th control.
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
