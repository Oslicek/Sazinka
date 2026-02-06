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
  isRouteAware: boolean;
  onRouteAwareToggle: (enabled: boolean) => void;
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
  isRouteAware,
  onRouteAwareToggle,
  onDateChange,
  onCrewChange,
  onDepotChange,
  crews,
  depots,
  isLoading,
}: RouteContextHeaderProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const days = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    const day = days[date.getDay()];
    return `${day} ${date.getDate()}.${date.getMonth() + 1}`;
  };

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <h1 className={styles.title}>Plánovací inbox</h1>
        
        <div className={styles.contextSelectors}>
          <div className={styles.selector}>
            <label htmlFor="route-date">Den</label>
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
            <label htmlFor="route-crew">Posádka</label>
            <select
              id="route-crew"
              value={context?.crewId ?? ''}
              onChange={(e) => onCrewChange(e.target.value)}
              className={styles.select}
            >
              <option value="">Vyberte posádku</option>
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>{crew.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.selector}>
            <label htmlFor="route-depot">Depo</label>
            <select
              id="route-depot"
              value={context?.depotId ?? ''}
              onChange={(e) => onDepotChange(e.target.value)}
              className={styles.select}
            >
              <option value="">Vyberte depo</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.routeAwareToggle}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={isRouteAware}
                onChange={(e) => onRouteAwareToggle(e.target.checked)}
                className={styles.toggleInput}
              />
              <span className={styles.toggleSwitch} />
              <span className={styles.toggleText}>Route-aware</span>
            </label>
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
          <span className={styles.noContext}>
            Vyberte den, posádku a depo pro zobrazení kapacity
          </span>
        )}
      </div>
    </header>
  );
}
