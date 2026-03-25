import { useTranslation } from 'react-i18next';
import styles from './AdvancedFilterPanel.module.css';

export interface AdvancedFilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeAdvancedCount: number;
  onClearAdvanced: () => void;
}

export function AdvancedFilterPanel({
  isOpen,
  activeAdvancedCount,
  onClearAdvanced,
}: AdvancedFilterPanelProps) {
  const { t } = useTranslation('customers');

  if (!isOpen) return null;

  return (
    <div data-testid="advanced-filter-panel" className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>{t('filter_advanced')}</span>
        {activeAdvancedCount > 0 && (
          <span data-testid="advanced-count-badge" className={styles.badge}>
            {activeAdvancedCount}
          </span>
        )}
        {activeAdvancedCount > 0 ? (
          <button
            type="button"
            data-testid="clear-advanced-btn"
            className={styles.clearBtn}
            onClick={onClearAdvanced}
          >
            {t('filter_clear_all')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="clear-advanced-btn"
            className={styles.clearBtn}
            onClick={onClearAdvanced}
            disabled
          >
            {t('filter_clear_all')}
          </button>
        )}
      </div>

      <div className={styles.sections}>
        {/* Contactability */}
        <section data-testid="section-contactability" className={styles.section}>
          <h3 className={styles.sectionHeading}>{t('adv_section_contactability')}</h3>
          <p className={styles.placeholder}>{t('adv_coming_soon')}</p>
        </section>

        {/* Lifecycle */}
        <section data-testid="section-lifecycle" className={styles.section}>
          <h3 className={styles.sectionHeading}>{t('adv_section_lifecycle')}</h3>
          <p className={styles.placeholder}>{t('adv_coming_soon')}</p>
        </section>

        {/* Data quality */}
        <section data-testid="section-data-quality" className={styles.section}>
          <h3 className={styles.sectionHeading}>{t('adv_section_data_quality')}</h3>
          <p className={styles.placeholder}>{t('adv_coming_soon')}</p>
        </section>
      </div>
    </div>
  );
}
