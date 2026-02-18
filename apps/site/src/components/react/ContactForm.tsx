import { useState, type FormEvent } from 'react';
import { countries } from '@sazinka/countries';
import styles from './ContactForm.module.css';
import { submitContact } from '../../lib/api';

type SubmitResult = { success: boolean; ticketId?: string };

interface ContactFormLabels {
  email: string;
  message: string;
  country: string;
  submit: string;
  sending: string;
  success: string;
  error: string;
}

interface ContactFormSubmitInput {
  email: string;
  message: string;
  locale: string;
  countryCode?: string | null;
  website?: string;
}

interface ContactFormProps {
  labels: ContactFormLabels;
  locale: string;
  onSubmit?: (data: ContactFormSubmitInput) => Promise<SubmitResult>;
}

const defaultSubmit = (data: ContactFormSubmitInput) => submitContact(data);

export default function ContactForm({ labels, locale, onSubmit = defaultSubmit }: ContactFormProps) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [countryCode, setCountryCode] = useState<string>('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; message?: string }>({});
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Resolve locale for country names
  const lang = locale.split('-')[0];
  const countryOptions = countries.map((c) => ({
    code: c.code,
    label: c.name[lang] ?? c.name['en'] ?? c.code,
  })).sort((a, b) => a.label.localeCompare(b.label));

  const validate = () => {
    const nextErrors: { email?: string; message?: string } = {};
    if (!email.trim()) {
      nextErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = 'Email is invalid';
    }
    if (!message.trim()) {
      nextErrors.message = 'Message is required';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      const submitResult = await onSubmit({ email, message, locale, countryCode: countryCode || null, website });
      setResult(submitResult);
      if (submitResult.success) {
        setEmail('');
        setMessage('');
        setCountryCode('');
        setWebsite('');
      }
    } catch {
      setResult({ success: false });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="contact-email">{labels.email}</label>
        <input
          id="contact-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={errors.email ? 'true' : 'false'}
        />
        {errors.email && <p className={styles.error}>{errors.email}</p>}
      </div>

      <div className={styles.field}>
        <label htmlFor="contact-message">{labels.message}</label>
        <textarea
          id="contact-message"
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-invalid={errors.message ? 'true' : 'false'}
        />
        {errors.message && <p className={styles.error}>{errors.message}</p>}
      </div>

      <div className={styles.field}>
        <label htmlFor="contact-country">{labels.country}</label>
        <select
          id="contact-country"
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          className={styles.select}
        >
          <option value=""></option>
          {countryOptions.map((opt) => (
            <option key={opt.code} value={opt.code}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.honeypotWrap}>
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          autoComplete="off"
          tabIndex={-1}
        />
      </div>

      <button type="submit" disabled={submitting} className={styles.submit}>
        {submitting ? labels.sending : labels.submit}
      </button>

      {result?.success && (
        <p className={styles.success}>
          {labels.success} {result.ticketId}
        </p>
      )}
      {result && !result.success && <p className={styles.error}>{labels.error}</p>}
    </form>
  );
}
