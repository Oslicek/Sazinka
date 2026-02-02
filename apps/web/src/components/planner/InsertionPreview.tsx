import styles from './InsertionPreview.module.css';

export interface InsertionInfo {
  insertAfterIndex: number;
  insertAfterName: string;
  insertBeforeIndex: number;
  insertBeforeName: string;
  deltaKm: number;
  deltaMin: number;
  estimatedArrival?: string;
  estimatedDeparture?: string;
}

interface InsertionPreviewProps {
  info: InsertionInfo;
  className?: string;
}

function formatDelta(value: number, unit: string): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}${unit}`;
}

export function InsertionPreview({ info, className }: InsertionPreviewProps) {
  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      <div className={styles.header}>
        <span className={styles.label}>Vložení do trasy</span>
      </div>

      <div className={styles.flow}>
        <div className={styles.stop}>
          <span className={styles.stopNumber}>{info.insertAfterIndex + 1}</span>
          <span className={styles.stopName}>{info.insertAfterName}</span>
        </div>

        <div className={styles.arrow}>
          <span className={styles.arrowLine} />
          <span className={styles.arrowIcon}>↓</span>
          <span className={styles.arrowLine} />
        </div>

        <div className={`${styles.stop} ${styles.newStop}`}>
          <span className={styles.stopNumber}>✦</span>
          <span className={styles.stopName}>Nová zastávka</span>
          {info.estimatedArrival && (
            <span className={styles.stopTime}>
              ETA {info.estimatedArrival}
              {info.estimatedDeparture && ` – ${info.estimatedDeparture}`}
            </span>
          )}
        </div>

        <div className={styles.arrow}>
          <span className={styles.arrowLine} />
          <span className={styles.arrowIcon}>↓</span>
          <span className={styles.arrowLine} />
        </div>

        <div className={styles.stop}>
          <span className={styles.stopNumber}>{info.insertBeforeIndex + 1}</span>
          <span className={styles.stopName}>{info.insertBeforeName}</span>
        </div>
      </div>

      <div className={styles.impact}>
        <span className={styles.impactLabel}>Dopad:</span>
        <span className={styles.impactValue}>
          {formatDelta(info.deltaMin, ' min')}
        </span>
        <span className={styles.impactValue}>
          {formatDelta(info.deltaKm, ' km')}
        </span>
      </div>
    </div>
  );
}
