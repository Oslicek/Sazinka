import { useTranslation } from 'react-i18next';
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

const problemLabelKeys: Record<ProblemType, { icon: string; key: string }> = {
  no_phone: { icon: '📵', key: 'problems_no_phone' },
  no_address: { icon: '🏠', key: 'problems_no_address' },
  geocode_failed: { icon: '📍', key: 'problems_geocode_failed' },
  no_coordinates: { icon: '🗺️', key: 'problems_no_coordinates' },
};

export function ProblemsSegment({
  candidates,
  onFixAddress,
  onAddPhone,
  onViewCustomer,
  isCollapsed = false,
  onToggleCollapse,
}: ProblemsSegmentProps) {
  const { t } = useTranslation('planner');
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
          {t('problems_title', { count: candidates.length })}
        </span>
        <span className={styles.headerDescription}>
          {t('problems_description')}
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
                    title={t(problemLabelKeys[problem].key)}
                  >
                    {problemLabelKeys[problem].icon}
                  </span>
                ))}
              </div>

              <div className={styles.itemActions}>
                {candidate.problems.includes('no_phone') && onAddPhone && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => onAddPhone(candidate.id)}
                    title={t('problems_add_phone')}
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
                      title={t('problems_fix_address')}
                    >
                      📍✎
                    </button>
                  )}
                {onViewCustomer && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => onViewCustomer(candidate.id)}
                    title={t('problems_view_customer')}
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
