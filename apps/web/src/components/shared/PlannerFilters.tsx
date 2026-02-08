/**
 * PlannerFilters - Shared filter bar for date range, crew, and depot.
 *
 * Used by Planner, WorkLog, and potentially other pages.
 */

import type { Crew } from '../../services/crewService';
import type { Depot } from '@shared/settings';
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
            title={isDateRange ? 'Jeden den' : 'Rozsah'}
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
          <option value="">Posádka: Vše</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>{crew.name}</option>
          ))}
        </select>

        <select
          value={filterDepotId}
          onChange={(e) => onDepotChange(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">Depo: Vše</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
