/**
 * PlannerFilters - Shared filter bar for date range, crew, and depot.
 *
 * Used by Planner, WorkLog, and potentially other pages.
 */

import { useTranslation } from 'react-i18next';
import type { Crew } from '../../services/crewService';
import type { Depot } from '@shared/settings';
import { getWeekdayNames } from '@/i18n/formatters';
import styles from './PlannerFilters.module.css';

export interface PlannerFiltersProps {
  dateFrom: string;
  dateTo: string;
  isDateRange: boolean;
  filterCrewId: string;
  filterDepotId: string;
  crews: Crew[];
  depots: Depot[];
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onToggleRange: () => void;
  onCrewChange: (value: string) => void;
  onDepotChange: (value: string) => void;
}

export function PlannerFilters({
  dateFrom,
  dateTo,
  isDateRange,
  filterCrewId,
  filterDepotId,
  crews,
  depots,
  onDateFromChange,
  onDateToChange,
  onToggleRange,
  onCrewChange,
  onDepotChange,
}: PlannerFiltersProps) {
  const { t } = useTranslation('common');
  return (
    <div className={styles.filtersSection}>
      <div className={styles.filterRow}>
        <div className={styles.dateFilter}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className={styles.dateInput}
          />
          {dateFrom && !isDateRange && (
            <span className={styles.weekdayLabel}>
              {getWeekdayNames('long')[(new Date(dateFrom + 'T00:00:00').getDay() + 6) % 7]}
            </span>
          )}
          {isDateRange && (
            <>
              <span className={styles.dateSeparator}>–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
                className={styles.dateInput}
              />
            </>
          )}
          <button
            type="button"
            className={`${styles.rangeToggle} ${isDateRange ? styles.rangeToggleActive : ''}`}
            onClick={onToggleRange}
            title={isDateRange ? t('filter_single_day') : t('filter_date_range')}
          >
            {isDateRange ? '1' : '...'}
          </button>
        </div>
      </div>

      <div className={styles.filterRow}>
        <select
          value={filterCrewId}
          onChange={(e) => onCrewChange(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">{t('filter_crew_all')}</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>{crew.name}</option>
          ))}
        </select>

        <select
          value={filterDepotId}
          onChange={(e) => onDepotChange(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">{t('filter_depot_all')}</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
