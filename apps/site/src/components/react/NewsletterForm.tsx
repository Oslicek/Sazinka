import { useState, type FormEvent } from 'react';
import styles from './NewsletterForm.module.css';
import { submitNewsletter } from '../../lib/api';

type SubmitResult = { success: boolean; pendingConfirmation?: boolean };

interface NewsletterLabels {
  emailPlaceholder: string;
  subscribe: string;
  subscribing: string;
  gdprConsent: string;
  success: string;
  error: string;
}

interface NewsletterFormSubmitInput {
  email: string;
  locale: string;
  gdprConsent: boolean;
  website?: string;
}

interface NewsletterFormProps {
  labels: NewsletterLabels;
  locale: string;
  variant: 'compact' | 'full';
  onSubmit?: (data: NewsletterFormSubmitInput) => Promise<SubmitResult>;
}

const defaultSubmit = (data: NewsletterFormSubmitInput) => submitNewsletter(data);

export default function NewsletterForm({
  labels,
  locale,
  variant,
  onSubmit = defaultSubmit,
}: NewsletterFormProps) {
  const [email, setEmail] = useState('');
  const [gdprConsent, setGdprConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Email is invalid');
      return;
    }
    if (!gdprConsent) {
      setError('Consent is required');
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmit({ email, locale, gdprConsent, website });
      if (result.success) {
        setSuccess(true);
        setEmail('');
        setGdprConsent(false);
        setWebsite('');
      } else {
        setError(labels.error);
      }
    } catch {
      setError(labels.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={variant === 'compact' ? styles.formCompact : styles.formFull} onSubmit={handleSubmit} noValidate>
      <div className={styles.row}>
        <input
          type="email"
          placeholder={labels.emailPlaceholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-label={labels.emailPlaceholder}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? labels.subscribing : labels.subscribe}
        </button>
      </div>

      <label className={styles.consent}>
        <input
          type="checkbox"
          checked={gdprConsent}
          onChange={(event) => setGdprConsent(event.target.checked)}
        />
        <span>{labels.gdprConsent}</span>
      </label>

      <div className={styles.honeypotWrap}>
        <label htmlFor="newsletter-website">Website</label>
        <input
          id="newsletter-website"
          type="text"
          name="website"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          autoComplete="off"
          tabIndex={-1}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>{labels.success}</p>}
    </form>
  );
}
