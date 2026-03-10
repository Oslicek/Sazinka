import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './Step.module.css';

export function Step4Depot() {
  const { t } = useTranslation('onboarding');
  const { setStep, setDepotName, email: wizardEmail, goBack } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = street.trim() && city.trim() && postal.trim();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setIsSubmitting(true);
    try {
      await request('sazinka.onboarding.complete', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          email: wizardEmail,
          depot: { name: name || city, street, city, postalCode: postal },
        },
      });
      setDepotName(name || city);
      setStep(5);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>{t('step4.title')}</h2>
      <p className={styles.subtitle}>{t('step4.subtitle')}</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label htmlFor="s4-name" className={styles.label}>{t('step4.name_label')}</label>
          <input
            id="s4-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('step4.name_placeholder')}
            className={styles.input}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s4-street" className={styles.label}>{t('step4.street_label')} *</label>
          <input
            id="s4-street"
            type="text"
            required
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder={t('step4.street_placeholder')}
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s4-city" className={styles.label}>{t('step4.city_label')} *</label>
          <input
            id="s4-city"
            type="text"
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('step4.city_placeholder')}
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s4-postal" className={styles.label}>{t('step4.postal_label')} *</label>
          <input
            id="s4-postal"
            type="text"
            required
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder={t('step4.postal_placeholder')}
            className={styles.input}
          />
        </div>

        <p className={styles.hint}>{t('step4.geocode_hint')}</p>

        <div className={styles.actions}>
          <button type="button" className={styles.backBtn} onClick={goBack}>
            {t('step4.back')}
          </button>
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? t('step4.submitting') : t('step4.continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
