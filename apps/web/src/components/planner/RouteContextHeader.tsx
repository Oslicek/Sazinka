import { useTranslation } from 'react-i18next';
import { getWeekdayNames } from '../../i18n/formatters';
import { CapacityMetrics, type RouteMetrics } from './CapacityMetrics';
import styles from './RouteContextHeader.module.css';

export interface RouteContext {
  date: string;
  crewId: string;
  crewName: string;
  depotId: string;
  depotName: string;
}

interface RouteContextHeaderProps {
  context: RouteContext | null;
  metrics: RouteMetrics | null;
  onDateChange: (date: string) => void;
  onCrewChange: (crewId: string) => void;
  onDepotChange: (depotId: string) => void;
  crews: Array<{ id: string; name: string }>;
  depots: Array<{ id: string; name: string }>;
  isLoading?: boolean;
}

export function RouteContextHeader({
  context,
  metrics,
  onDateChange,
  onCrewChange,
  onDepotChange,
  crews,
  depots,
  isLoading,
}: RouteContextHeaderProps) {
  const { t } = useTranslation('planner');
  const weekdayNames = getWeekdayNames('short');
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const dayIndex = (date.getDay() + 6) % 7; // Map Sun=0 to index 6 (last in Mon-first array)
    const day = weekdayNames[dayIndex];
    return `${day} ${date.getDate()}.${date.getMonth() + 1}`;
  };

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <h1 className={styles.title}>{t('page_title')}</h1>
        
        <div className={styles.contextSelectors}>
          <div className={styles.selector}>
            <label htmlFor="route-date">{t('context_day')}</label>
            <input
              id="route-date"
              type="date"
              value={context?.date ?? ''}
              onChange={(e) => onDateChange(e.target.value)}
              className={styles.dateInput}
            />
            {context?.date && (
              <span className={styles.dateLabel}>{formatDate(context.date)}</span>
            )}
          </div>

          <div className={styles.selector}>
            <label htmlFor="route-crew">{t('context_crew')}</label>
            <select
              id="route-crew"
              value={context?.crewId ?? ''}
              onChange={(e) => onCrewChange(e.target.value)}
              className={styles.select}
            >
              <option value="">{t('context_crew_select')}</option>
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>{crew.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.selector}>
            <label htmlFor="route-depot">{t('context_depot')}</label>
            <select
              id="route-depot"
              value={context?.depotId ?? ''}
              onChange={(e) => onDepotChange(e.target.value)}
              className={styles.select}
            >
              <option value="">{t('context_depot_select')}</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      <div className={styles.metricsRow}>
        {isLoading ? (
          <div className={styles.metricsSkeleton}>
            <span className={styles.skeletonItem} />
            <span className={styles.skeletonItem} />
            <span className={styles.skeletonItem} />
            <span className={styles.skeletonItem} />
          </div>
        ) : metrics ? (
          <CapacityMetrics metrics={metrics} />
        ) : (
          <span className={styles.noContext}>{t('context_no_metrics')}</span>
        )}
      </div>
    </header>
  );
}
