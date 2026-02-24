import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './Step.module.css';

/** Password strength score: 0–4 */
function scorePassword(pw: string): number {
  if (pw.length < 4) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_LABELS = ['', 'strength_weak', 'strength_fair', 'strength_good', 'strength_strong'] as const;
const STRENGTH_COLORS = ['', '#ef4444', '#f59e0b', '#22c55e', '#16a34a'];

export function Step1Account() {
  const { t } = useTranslation('onboarding');
  const { setStep, setEmail: saveEmail, locale, country, goBack } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tosChecked, setTosChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const strength = scorePassword(password);
  const strengthLabel = STRENGTH_LABELS[strength] ?? 'strength_weak';
  const strengthColor = STRENGTH_COLORS[strength] ?? '#ef4444';
  const strengthWidth = `${(strength / 4) * 100}%`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!tosChecked) {
      setError(t('step1.error_tos'));
      return;
    }
    if (password !== confirm) {
      setError(t('step1.error_password_mismatch'));
      return;
    }
    if (strength < 4) {
      setError(t('step1.error_password_weak'));
      return;
    }

    setIsSubmitting(true);
    try {
      await request('sazinka.auth.register.start', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: { email, password, locale, country, tosAccepted: true },
      });
      saveEmail(email);
      setStep('verify');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('RATE_LIMITED')) {
        setError(t('step1.error_rate_limit'));
      } else if (msg.includes('WEAK_PASSWORD')) {
        setError(t('step1.error_password_weak'));
      } else {
        // Anti-enumeration: always show the generic message, even on "duplicate email"
        saveEmail(email);
        setStep('verify');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>{t('step1.title')}</h2>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label htmlFor="s1-email" className={styles.label}>{t('step1.email_label')}</label>
          <input
            id="s1-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('step1.email_placeholder')}
            className={styles.input}
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="s1-pw" className={styles.label}>{t('step1.password_label')}</label>
          <input
            id="s1-pw"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('step1.password_placeholder')}
            className={styles.input}
            autoComplete="new-password"
          />
          {password.length > 0 && (
            <div className={styles.strengthBar}>
              <div
                className={styles.strengthFill}
                style={{ width: strengthWidth, background: strengthColor }}
              />
            </div>
          )}
          {password.length > 0 && (
            <span className={styles.strengthLabel} style={{ color: strengthColor }}>
              {t(`step1.${strengthLabel}`)}
            </span>
          )}
          <p className={styles.hint}>{t('step1.password_hint')}</p>
        </div>

        <div className={styles.field}>
          <label htmlFor="s1-confirm" className={styles.label}>{t('step1.confirm_label')}</label>
          <input
            id="s1-confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t('step1.confirm_placeholder')}
            className={styles.input}
            autoComplete="new-password"
          />
        </div>

        <div className={styles.tosRow}>
          <input
            id="s1-tos"
            type="checkbox"
            checked={tosChecked}
            onChange={(e) => setTosChecked(e.target.checked)}
            className={styles.checkbox}
          />
          <label htmlFor="s1-tos" className={styles.tosLabel}>
            {t('step1.tos_label')}{' '}
            <a href="/tos" target="_blank" rel="noopener noreferrer" className={styles.tosLink}>
              {t('step1.tos_link')}
            </a>{' '}
            {t('step1.tos_and')}{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className={styles.tosLink}>
              {t('step1.privacy_link')}
            </a>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.backBtn} onClick={goBack}>
            {t('step1.back')}
          </button>
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={isSubmitting || !email || !password || !confirm || !tosChecked}
          >
            {isSubmitting ? t('step1.submitting') : t('step1.continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
