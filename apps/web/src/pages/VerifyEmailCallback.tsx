import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import styles from './Login.module.css';

type Status = 'verifying' | 'success' | 'error';

export function VerifyEmailCallback() {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  // TanStack Router search params
  const search = useSearch({ strict: false }) as Record<string, string>;
  const token = search['token'] ?? '';

  const request = useNatsStore((s) => s.request);

  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg(t('verify_callback.error_invalid'));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await request(
          'sazinka.auth.email.verify',
          {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            payload: { token },
          }
        );

        if (cancelled) return;

        setStatus('success');

        // Redirect to /register which will show the wizard at step 2
        setTimeout(() => {
          navigate({ to: '/register', search: { step: '2' } });
        }, 1500);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setErrorMsg(
          msg.includes('INVALID_OR_EXPIRED_TOKEN')
            ? t('verify_callback.error_invalid')
            : t('verify_callback.error_generic')
        );
      }
    })();

    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>Ariadline</h1>
        </div>

        {status === 'verifying' && (
          <p className={styles.subtitle}>{t('verify_callback.verifying')}</p>
        )}

        {status === 'success' && (
          <p className={styles.subtitle} style={{ color: '#16a34a' }}>
            {t('verify_callback.success')}
          </p>
        )}

        {status === 'error' && (
          <>
            <div className={styles.error}>{errorMsg}</div>
            <div className={styles.footer}>
              <a href="/register" className={styles.link}>
                {t('verify_callback.request_new')}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
