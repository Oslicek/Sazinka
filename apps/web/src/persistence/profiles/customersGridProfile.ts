/**
 * customers.grid — local-scoped UPP profile for long-term grid personalization.
 *
 * Stores sortModel, visibleColumns, and columnOrder in localStorage so
 * preferences survive page refreshes and are shared across browser tabs.
 * Component-boundary sanitizers are wired in via the `sanitize` field so
 * corrupted/wrong-shaped values are normalized on hydration.
 */
import type { PersistenceProfile } from '../core/types';
import {
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  sanitizeSortModel,
  sanitizeVisibleColumns,
  sanitizeColumnOrder,
} from '@/lib/customerColumns';

export const CUSTOMERS_GRID_PROFILE_ID = 'customers.grid';

export const customersGridProfile: PersistenceProfile = {
  profileId: CUSTOMERS_GRID_PROFILE_ID,
  controls: [
    {
      controlId: 'sortModel',
      pluginId: 'json',
      defaultValue: DEFAULT_SORT_MODEL,
      writeMode: 'immediate',
      validators: [],
      sanitize: sanitizeSortModel,
    },
    {
      controlId: 'visibleColumns',
      pluginId: 'json',
      defaultValue: DEFAULT_VISIBLE_COLUMNS,
      writeMode: 'immediate',
      validators: [],
      sanitize: sanitizeVisibleColumns,
    },
    {
      controlId: 'columnOrder',
      pluginId: 'json',
      defaultValue: DEFAULT_COLUMN_ORDER,
      writeMode: 'immediate',
      validators: [],
      sanitize: sanitizeColumnOrder,
    },
  ],
  readPriority: ['local'],
  writeTargets: ['local'],
};
