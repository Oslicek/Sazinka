import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useWizard } from './OnboardingWizard';
import styles from './Step.module.css';
import doneCss from './Step5Done.module.css';

export function Step5Done() {
  const { t } = useTranslation('onboarding');
  const { deviceTypeCount, depotName } = useWizard();
  const navigate = useNavigate();

  const deviceSummary = deviceTypeCount === 1
    ? t('step5.devices_done', { count: deviceTypeCount })
    : t('step5.devices_done_plural', { count: deviceTypeCount });

  return (
    <div className={styles.card}>
      <div className={doneCss.checkmark} aria-hidden="true">🎉</div>
      <h2 className={styles.title}>{t('step5.title')}</h2>

      <ul className={styles.summaryList}>
        <li className={styles.summaryItem}>{t('step5.account_done')}</li>
        <li className={styles.summaryItem}>{deviceSummary}</li>
        {depotName && (
          <li className={styles.summaryItem}>
            {t('step5.depot_done', { name: depotName })}
          </li>
        )}
        <li className={styles.summaryItem}>{t('step5.crew_done')}</li>
      </ul>

      <p className={doneCss.trialText}>{t('step5.trial')}</p>
      <p className={doneCss.trialHint}>{t('step5.trial_hint')}</p>

      <button
        type="button"
        className={styles.continueBtn}
        style={{ width: '100%', marginTop: '1rem' }}
        onClick={() => navigate({ to: '/' })}
      >
        {t('step5.go_dashboard')}
      </button>
    </div>
  );
}
