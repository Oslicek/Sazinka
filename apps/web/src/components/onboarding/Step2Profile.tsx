import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './Step.module.css';

const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Čeština' },
  { code: 'sk', label: 'Slovenčina' },
] as const;

export function Step2Profile() {
  const { t } = useTranslation('onboarding');
  const { setStep, locale, setLocale, country, goBack } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [name, setName] = useState('');
  const [business, setBusiness] = useState('');
  const [phone, setPhone] = useState('');
  const [ico, setIco] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await request('sazinka.onboarding.profile', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          name,
          businessName: business || undefined,
          phone: phone || undefined,
          ico: ico || undefined,
          locale,
          country,
        },
      });
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>{t('step2.title')}</h2>

      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label htmlFor="s2-name" className={styles.label}>{t('step2.name_label')} *</label>
          <input
            id="s2-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('step2.name_placeholder')}
            className={styles.input}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s2-biz" className={styles.label}>{t('step2.business_label')}</label>
          <input
            id="s2-biz"
            type="text"
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            placeholder={t('step2.business_placeholder')}
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s2-phone" className={styles.label}>{t('step2.phone_label')}</label>
          <input
            id="s2-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('step2.phone_placeholder')}
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s2-ico" className={styles.label}>{t('step2.ico_label')}</label>
          <input
            id="s2-ico"
            type="text"
            value={ico}
            onChange={(e) => setIco(e.target.value)}
            placeholder={t('step2.ico_placeholder')}
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s2-locale" className={styles.label}>{t('step2.language_label')}</label>
          <select
            id="s2-locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className={styles.input}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>{t('step2.country_label')}</label>
          <input
            type="text"
            readOnly
            value={country}
            className={styles.input}
            style={{ background: '#f9fafb', cursor: 'default' }}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.backBtn} onClick={goBack}>
            {t('step2.back')}
          </button>
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={isSubmitting || !name}
          >
            {isSubmitting ? t('step2.submitting') : t('step2.continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
