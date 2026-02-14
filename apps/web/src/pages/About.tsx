import { useTranslation } from 'react-i18next';
import styles from './About.module.css';

export function About() {
  const { t } = useTranslation('pages');

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('about_title')}</h1>
        
        <section className={styles.section}>
          <h2>{t('about_what')}</h2>
          <p>
            {t('about_description')}
          </p>
        </section>

        <section className={styles.section}>
          <h2>{t('about_features')}</h2>
          <ul className={styles.featureList}>
            <li>{t('about_feature_customers')}</li>
            <li>{t('about_feature_planning')}</li>
            <li>{t('about_feature_routes')}</li>
            <li>{t('about_feature_calendar')}</li>
            <li>{t('about_feature_import')}</li>
            <li>{t('about_feature_crews')}</li>
            <li>{t('about_feature_roles')}</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>{t('about_version')}</h2>
          <p className={styles.version}>v0.16.0 (2026-02-07)</p>
        </section>
      </div>
    </div>
  );
}
