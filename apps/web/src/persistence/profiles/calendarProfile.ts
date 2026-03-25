/**
 * Calendar page persistence profile.
 *
 * Controls (3):
 *  - currentDateKey: YYYY-MM-DD string — the displayed month/week/day (P1-3)
 *  - selectedDayKey: YYYY-MM-DD string | '' — currently opened day panel (P1-3)
 *  - layoutMode: 'month' | 'week' | 'day' | 'agenda' — active calendar layout
 *
 * URL params carry filter state (viewMode, types, status, crew, customer)
 * and are NOT duplicated here. Only date/day/layout navigation state lives in this profile.
 */
import type { PersistenceProfile } from '../core/types';

export const CALENDAR_PROFILE_ID = 'calendar.ui';

export const LAYOUT_MODES = ['month', 'week', 'day', 'agenda'] as const;

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
    {
      controlId: 'layoutMode',
      pluginId: 'enum',
      defaultValue: '',
      writeMode: 'immediate',
      validators: [],
    },
  ],
  readPriority: ['session'],
  writeTargets: ['session'],
};
