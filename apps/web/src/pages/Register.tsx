import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/authStore';
import { useNatsStore } from '@/stores/natsStore';
import styles from './Login.module.css'; // Reuse Login styles

export function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const isConnected = useNatsStore((s) => s.isConnected);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return;

    setIsSubmitting(true);
    try {
      await register(email, password, name, businessName || undefined);
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
          <h1 className={styles.title}>Sazinka</h1>
          <p className={styles.subtitle}>Vytvoření nového účtu</p>
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
            <label htmlFor="name" className={styles.label}>Jméno</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              placeholder="Jan Novák"
              required
              autoFocus
            />
          </div>

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
              placeholder="Minimálně 8 znaků"
              required
              autoComplete="new-password"
              minLength={8}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="businessName" className={styles.label}>Název firmy <span style={{ fontWeight: 400, color: '#9ca3af' }}>(volitelné)</span></label>
            <input
              id="businessName"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={styles.input}
              placeholder="Revize s.r.o."
            />
          </div>

          <button
            type="submit"
            className={styles.button}
            disabled={isSubmitting || !isConnected || !name || !email || !password}
          >
            {isSubmitting ? 'Registrace...' : 'Zaregistrovat se'}
          </button>
        </form>

        <div className={styles.footer}>
          <p>
            Máte již účet?{' '}
            <Link to="/login" className={styles.link}>Přihlaste se</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
