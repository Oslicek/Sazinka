import styles from './MultiCrewTip.module.css';

export interface CrewComparison {
  crewId: string;
  crewName: string;
  deltaMin: number;
  deltaKm: number;
  isBetter: boolean;
  savingsMin?: number;
  savingsKm?: number;
}

interface MultiCrewTipProps {
  currentCrew: string;
  comparisons: CrewComparison[];
  onSwitchCrew?: (crewId: string) => void;
  minSavingsMin?: number;
  minSavingsKm?: number;
}

/**
 * Shows a tip when another crew would be significantly better for insertion.
 * Only displays if savings exceed the configured thresholds.
 */
export function MultiCrewTip({
  currentCrew,
  comparisons,
  onSwitchCrew,
  minSavingsMin = 10,
  minSavingsKm = 5,
}: MultiCrewTipProps) {
  // Find the best alternative crew
  const betterCrews = comparisons.filter((c) => {
    if (!c.isBetter) return false;
    const savingsMin = c.savingsMin ?? 0;
    const savingsKm = c.savingsKm ?? 0;
    return savingsMin >= minSavingsMin || savingsKm >= minSavingsKm;
  });

  // Sort by biggest savings
  betterCrews.sort((a, b) => {
    const savingsA = (a.savingsMin ?? 0) + (a.savingsKm ?? 0) * 2;
    const savingsB = (b.savingsMin ?? 0) + (b.savingsKm ?? 0) * 2;
    return savingsB - savingsA;
  });

  const bestAlternative = betterCrews[0];

  if (!bestAlternative) {
    return null;
  }

  const formatSavings = () => {
    const parts: string[] = [];
    if (bestAlternative.savingsMin && bestAlternative.savingsMin >= minSavingsMin) {
      parts.push(`${Math.round(bestAlternative.savingsMin)} min`);
    }
    if (bestAlternative.savingsKm && bestAlternative.savingsKm >= minSavingsKm) {
      parts.push(`${bestAlternative.savingsKm.toFixed(1)} km`);
    }
    return parts.join(' / ');
  };

  return (
    <div className={styles.container}>
      <span className={styles.icon}>💡</span>
      <div className={styles.content}>
        <span className={styles.label}>Tip:</span>
        <span className={styles.message}>
          <strong>{bestAlternative.crewName}</strong> je lepší o{' '}
          <strong>{formatSavings()}</strong>
        </span>
      </div>
      {onSwitchCrew && (
        <button
          type="button"
          className={styles.switchButton}
          onClick={() => onSwitchCrew(bestAlternative.crewId)}
        >
          Přepnout
        </button>
      )}
    </div>
  );
}
