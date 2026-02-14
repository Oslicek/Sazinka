import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useNatsStore } from '@/stores/natsStore';
import styles from './Login.module.css';

export function Login() {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const isConnected = useNatsStore((s) => s.isConnected);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);
    try {
      await login(email, password);
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
          <p className={styles.subtitle}>{t('login_title')}</p>
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
              autoFocus
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
              placeholder={t('password_placeholder')}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className={styles.button}
            disabled={isSubmitting || !isConnected || !email}
          >
            {isSubmitting ? t('login_button_loading') : t('login_button')}
          </button>
        </form>

        <div className={styles.footer}>
          <p>
            {t('no_account')}{' '}
            <Link to="/register" className={styles.link}>{t('register_link')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
