/**
 * Customers page persistence profile (session-scoped).
 *
 * Controls (5):
 *  - search: text input (debounced)
 *  - viewMode: 'table' | 'cards'
 *  - revisionFilter: '' | 'overdue' | 'week' | 'month'
 *  - selectedCustomerId: UUID string | null — last selected customer
 *  - isAdvancedFiltersOpen: boolean
 *
 * Removed (Phase 6): geocodeFilter, typeFilter — replaced by per-column checklist filters.
 * Stale persisted values for those keys are safely ignored on hydration.
 *
 * NOTE: sortBy/sortOrder were removed in Phase 1C.
 * Sorting now lives in customers.grid (local) as sortModel.
 * Column filters (columnFilters) live in customers.grid (local) as well.
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
      controlId: 'revisionFilter',
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
    {
      controlId: 'isAdvancedFiltersOpen',
      pluginId: 'enum',
      defaultValue: false,
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['url', 'session', 'local'],
  writeTargets: ['session'],
};
