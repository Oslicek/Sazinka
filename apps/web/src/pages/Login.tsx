import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useNatsStore } from '@/stores/natsStore';
import styles from './Login.module.css';

export function Login() {
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
          <p className={styles.subtitle}>Přihlášení do systému</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}

          {!isConnected && (
            <div className={styles.warning}>
              Server není dostupný. Zkontrolujte připojení.
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              placeholder="vas@email.cz"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Heslo</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              placeholder="Vaše heslo"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className={styles.button}
            disabled={isSubmitting || !isConnected || !email}
          >
            {isSubmitting ? 'Přihlašování...' : 'Přihlásit se'}
          </button>
        </form>

        <div className={styles.footer}>
          <p>
            Nemáte účet?{' '}
            <Link to="/register" className={styles.link}>Zaregistrujte se</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
