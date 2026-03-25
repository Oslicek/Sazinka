/**
 * Calendar page persistence profile.
 *
 * Controls (2):
 *  - currentDateKey: YYYY-MM-DD string — the displayed month/week/day (P1-3)
 *  - selectedDayKey: YYYY-MM-DD string | '' — currently opened day panel (P1-3)
 *
 * URL params carry filter state (viewMode, layoutMode, types, status, crew, customer)
 * and are NOT duplicated here. Only date/day navigation state lives in this profile.
 */
import type { PersistenceProfile } from '../core/types';

export const CALENDAR_PROFILE_ID = 'calendar.ui';

export const calendarProfile: PersistenceProfile = {
  profileId: CALENDAR_PROFILE_ID,
  controls: [
    {
      controlId: 'currentDateKey',
      pluginId: 'text',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
    {
      controlId: 'selectedDayKey',
      pluginId: 'text',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['session'],
  writeTargets: ['session'],
};
