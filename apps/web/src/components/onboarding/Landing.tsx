import { lazy, Suspense, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useWizard } from './OnboardingWizard';
import styles from './Landing.module.css';

const WaitlistForm = lazy(() => import('./WaitlistForm').then(m => ({ default: m.WaitlistForm })));

const SUPPORTED_LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'cs', label: 'CS' },
  { code: 'sk', label: 'SK' },
] as const;

const COMING_SOON = [
  { code: 'SK', flag: '🇸🇰', nameKey: 'landing.country_SK' },
  { code: 'AT', flag: '🇦🇹', nameKey: 'landing.country_AT' },
] as const;

export function Landing() {
  const { t } = useTranslation('onboarding');
  const { setStep, setCountry, locale, setLocale } = useWizard();
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistCountry, setWaitlistCountry] = useState('');

  const handleStartTrial = () => {
    setCountry('CZ');
    setStep(1);
  };

  const handleNotifyMe = (country: string) => {
    setWaitlistCountry(country);
    setShowWaitlist(true);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.logo}>Sazinka</h1>
          <p className={styles.tagline}>{t('landing.headline')}</p>
        </div>

        {/* CZ — available */}
        <div className={styles.countryCard}>
          <span className={styles.flag}>🇨🇿</span>
          <div className={styles.countryInfo}>
            <span className={styles.countryName}>{t('landing.country_CZ')}</span>
            <span className={styles.badge}>{t('landing.available_now')}</span>
            <span className={styles.trialBadge}>{t('landing.trial_badge')}</span>
          </div>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleStartTrial}
          >
            {t('landing.start_trial')}
          </button>
        </div>

        {/* Coming soon countries */}
        <div className={styles.comingSoonSection}>
          <p className={styles.comingSoonTitle}>{t('landing.coming_soon')}:</p>
          {COMING_SOON.map((c) => (
            <div key={c.code} className={styles.comingCard}>
              <span className={styles.flag}>{c.flag}</span>
              <span className={styles.countryName}>{t(c.nameKey)}</span>
              <button
                type="button"
                className={styles.notifyBtn}
                onClick={() => handleNotifyMe(c.code)}
              >
                {t('landing.notify_me')}
              </button>
            </div>
          ))}
        </div>

        {/* Different country */}
        <div className={styles.differentCountry}>
          <button
            type="button"
            className={styles.differentBtn}
            onClick={() => {
              setWaitlistCountry('');
              setShowWaitlist(true);
            }}
          >
            {t('landing.different_country')}
          </button>
          <p className={styles.differentHint}>{t('landing.different_country_hint')}</p>
        </div>

        {/* Inline waitlist form */}
        {showWaitlist && (
          <Suspense fallback={<div className={styles.loading}>…</div>}>
            <WaitlistForm
              defaultCountry={waitlistCountry}
              onDone={() => setShowWaitlist(false)}
            />
          </Suspense>
        )}

        <hr className={styles.divider} />

        {/* Sign in link */}
        <p className={styles.loginRow}>
          {t('landing.already_account')}{' '}
          <Link to="/login" className={styles.link}>{t('landing.sign_in')}</Link>
        </p>

        {/* Language switcher */}
        <div className={styles.localeSwitcher} role="group" aria-label="Language">
          {SUPPORTED_LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              className={[styles.localeBtn, locale === l.code ? styles.localeActive : ''].join(' ')}
              onClick={() => setLocale(l.code)}
              aria-pressed={locale === l.code}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
