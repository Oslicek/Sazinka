import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './WaitlistForm.module.css';

const CountrySelect = lazy(() =>
  import('@/components/common/CountrySelect').then(m => ({ default: m.CountrySelect }))
);

interface Props {
  defaultCountry?: string;
  onDone: () => void;
}

export function WaitlistForm({ defaultCountry = '', onDone }: Props) {
  const { t } = useTranslation('onboarding');
  const { locale } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [email, setEmail] = useState('');
  const [country, setCountry] = useState(defaultCountry);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !country) return;

    setIsSubmitting(true);
    setError('');
    try {
      await request('sazinka.waitlist.join', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: { email, country, locale },
      });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('RATE_LIMITED')) {
        setError(t('waitlist.error_rate_limit'));
      } else {
        setError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className={styles.success}>
        <p>{t('waitlist.success')}</p>
        <button type="button" className={styles.doneBtn} onClick={onDone}>✕</button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <p className={styles.title}>{t('waitlist.title')}</p>

      {error && <p className={styles.error}>{error}</p>}

      <label className={styles.label} htmlFor="wl-email">{t('waitlist.email_label')}</label>
      <input
        id="wl-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('waitlist.email_placeholder')}
        className={styles.input}
        autoComplete="email"
      />

      <label className={styles.label} htmlFor="wl-country">{t('waitlist.country_label')}</label>
      <Suspense fallback={<div className={styles.countryFallback}>…</div>}>
        <CountrySelect
          value={country}
          onChange={(code) => setCountry(code ?? '')}
          className={styles.input}
        />
      </Suspense>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onDone}
        >✕</button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={isSubmitting || !email || !country}
        >
          {isSubmitting ? '…' : t('waitlist.submit')}
        </button>
      </div>
    </form>
  );
}
