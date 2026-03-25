/**
 * Jobs page persistence profile.
 *
 * Controls (1):
 *  - historyFilter: 'all' | 'completed' | 'failed' | 'cancelled' — active tab in job history
 */
import type { PersistenceProfile } from '../core/types';

export const JOBS_PROFILE_ID = 'jobs.ui';

export const HISTORY_FILTER_VALUES = ['all', 'completed', 'failed', 'cancelled'] as const;
export type HistoryFilter = typeof HISTORY_FILTER_VALUES[number];

export const jobsProfile: PersistenceProfile = {
  profileId: JOBS_PROFILE_ID,
  controls: [
    {
      controlId: 'historyFilter',
      pluginId: 'enum',
      defaultValue: 'all',
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['session'],
  writeTargets: ['session'],
};
