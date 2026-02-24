import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './VerifyEmail.module.css';

const RESEND_COOLDOWN_SECS = 60;

export function VerifyEmail() {
  const { t } = useTranslation('onboarding');
  const { email, locale, setStep } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [cooldown, setCooldown] = useState(0);
  const [resendMsg, setResendMsg] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECS);
    intervalRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(intervalRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResendMsg('');
    try {
      await request('sazinka.auth.email.resend', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: { email, locale },
      });
      setResendMsg(t('verify_email.resend_success'));
      startCooldown();
    } catch {
      startCooldown();
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.icon} aria-hidden="true">📬</div>
      <h2 className={styles.title}>{t('verify_email.title')}</h2>
      <p className={styles.description}>
        {t('verify_email.description')}{' '}
        <strong>{email}</strong>.
      </p>
      <p className={styles.description2}>{t('verify_email.description2')}</p>

      {resendMsg && <p className={styles.successMsg}>{resendMsg}</p>}

      <button
        type="button"
        className={styles.resendBtn}
        onClick={handleResend}
        disabled={cooldown > 0}
      >
        {cooldown > 0
          ? t('verify_email.resend_wait', { seconds: cooldown })
          : t('verify_email.resend')}
      </button>

      <p className={styles.hint}>{t('verify_email.no_email')}</p>

      {import.meta.env.DEV && (
        <button
          type="button"
          className={styles.devSkip}
          onClick={() => setStep(2)}
        >
          Skip verification (dev)
        </button>
      )}
    </div>
  );
}
