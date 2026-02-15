import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useNatsStore } from '@/stores/natsStore';
import styles from './Login.module.css'; // Reuse Login styles

/** Map browser language to a supported locale. */
function detectLocale(): string {
  const nav = navigator.language; // e.g. "cs", "cs-CZ", "en-US"
  const base = nav.split('-')[0].toLowerCase();
  if (base === 'cs') return 'cs';
  if (base === 'sk') return 'sk';
  return 'en'; // default
}

const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Čeština' },
  { code: 'sk', label: 'Slovenčina' },
] as const;

export function Register() {
  const { t, i18n } = useTranslation('auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [locale, setLocale] = useState(detectLocale);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const isConnected = useNatsStore((s) => s.isConnected);
  const navigate = useNavigate();

  // Sync i18n language with selected locale so the form re-renders
  useEffect(() => {
    if (i18n.language !== locale) {
      i18n.changeLanguage(locale);
    }
  }, [locale, i18n]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return;

    setIsSubmitting(true);
    try {
      await register(email, password, name, businessName || undefined, locale);
      navigate({ to: '/' });
    } catch {
      // Error is already set in the store
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>Ariadline</h1>
          <p className={styles.subtitle}>{t('register_title')}</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}

          {!isConnected && (
            <div className={styles.warning}>
              {t('server_unavailable')}
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="name" className={styles.label}>{t('name_label')}</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              placeholder={t('name_placeholder')}
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>{t('email_label')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              placeholder={t('email_placeholder')}
              required
              autoComplete="email"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>{t('password_label')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              placeholder={t('password_placeholder_register')}
              required
              autoComplete="new-password"
              minLength={8}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="businessName" className={styles.label}>
              {t('business_name_label')}{' '}
              <span style={{ fontWeight: 400, color: '#9ca3af' }}>{t('business_name_optional')}</span>
            </label>
            <input
              id="businessName"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={styles.input}
              placeholder={t('business_name_placeholder')}
            />
          </div>

          <div className={styles.localeField}>
            <label htmlFor="locale" className={styles.label}>{t('locale_label')}</label>
            <select
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className={styles.localeSelect}
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <p className={styles.localeHint}>{t('locale_confirm')}</p>
          </div>

          <button
            type="submit"
            className={styles.button}
            disabled={isSubmitting || !isConnected || !name || !email || !password}
          >
            {isSubmitting ? t('register_button_loading') : t('register_button')}
          </button>
        </form>

        <div className={styles.footer}>
          <p>
            {t('have_account')}{' '}
            <Link to="/login" className={styles.link}>{t('login_link')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
