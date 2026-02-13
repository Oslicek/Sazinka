import { CollapseButton } from '../common';
import styles from './ProblemsSegment.module.css';

export type ProblemType = 'no_phone' | 'no_address' | 'geocode_failed' | 'no_coordinates';

export interface ProblemCandidate {
  id: string;
  customerName: string;
  city: string;
  problems: ProblemType[];
}

interface ProblemsSegmentProps {
  candidates: ProblemCandidate[];
  onFixAddress?: (id: string) => void;
  onAddPhone?: (id: string) => void;
  onViewCustomer?: (id: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const problemLabels: Record<ProblemType, { icon: string; label: string }> = {
  no_phone: { icon: '📵', label: 'Chybí telefon' },
  no_address: { icon: '🏠', label: 'Chybí adresa' },
  geocode_failed: { icon: '📍', label: 'Nelze geolokalizovat' },
  no_coordinates: { icon: '🗺️', label: 'Bez souřadnic' },
};

export function ProblemsSegment({
  candidates,
  onFixAddress,
  onAddPhone,
  onViewCustomer,
  isCollapsed = false,
  onToggleCollapse,
}: ProblemsSegmentProps) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.header}
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
      >
        <span className={styles.headerIcon}>⚠️</span>
        <span className={styles.headerTitle}>
          Problémy ({candidates.length})
        </span>
        <span className={styles.headerDescription}>
          Kandidáti, které nelze optimalizovat
        </span>
        <CollapseButton
          collapsed={isCollapsed}
          onClick={() => { /* handled by parent button */ }}
        />
      </button>

      {!isCollapsed && (
        <div className={styles.list}>
          {candidates.map((candidate) => (
            <div key={candidate.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>{candidate.customerName}</span>
                <span className={styles.itemCity}>{candidate.city}</span>
              </div>

              <div className={styles.itemProblems}>
                {candidate.problems.map((problem) => (
                  <span
                    key={problem}
                    className={styles.problemBadge}
                    title={problemLabels[problem].label}
                  >
                    {problemLabels[problem].icon}
                  </span>
                ))}
              </div>

              <div className={styles.itemActions}>
                {candidate.problems.includes('no_phone') && onAddPhone && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => onAddPhone(candidate.id)}
                    title="Doplnit telefon"
                  >
                    📞+
                  </button>
                )}
                {(candidate.problems.includes('geocode_failed') ||
                  candidate.problems.includes('no_address') ||
                  candidate.problems.includes('no_coordinates')) &&
                  onFixAddress && (
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => onFixAddress(candidate.id)}
                      title="Opravit adresu"
                    >
                      📍✎
                    </button>
                  )}
                {onViewCustomer && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => onViewCustomer(candidate.id)}
                    title="Detail zákazníka"
                  >
                    →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
