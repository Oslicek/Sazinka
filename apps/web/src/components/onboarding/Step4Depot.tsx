import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './Step.module.css';

const LeafletMap = lazy(() => import('./LeafletMap').then(m => ({ default: m.LeafletMap })));

type GeoState = 'idle' | 'verifying' | 'verified' | 'error';

export function Step4Depot() {
  const { t } = useTranslation('onboarding');
  const { setStep, setDepotName, goBack } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const [geoError, setGeoError] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canVerify = street.trim() && city.trim() && postal.trim();

  const resetVerification = () => {
    setGeoState('idle');
    setLat(null);
    setLng(null);
    setShowMap(false);
    setGeoError('');
  };

  const handleVerify = async () => {
    setGeoState('verifying');
    setGeoError('');
    setShowMap(false);
    try {
      const resp = await request<unknown, { payload: { lat: number; lng: number } }>(
        'sazinka.onboarding.geocode.depot',
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          payload: { street, city, postalCode: postal },
        }
      );
      setLat(resp.payload.lat);
      setLng(resp.payload.lng);
      setGeoState('verified');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGeoError(msg.includes('RATE_LIMITED') ? t('step4.error_rate_limit') : t('step4.error_not_found'));
      setGeoState('error');
      setShowMap(true);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (geoState !== 'verified' || lat === null || lng === null) return;
    setError('');
    setIsSubmitting(true);
    try {
      await request('sazinka.onboarding.complete', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          depot: { name: name || city, street, city, postalCode: postal, lat, lng },
        },
      });
      setDepotName(name || city);
      setStep(5);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>{t('step4.title')}</h2>
      <p className={styles.subtitle}>{t('step4.subtitle')}</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label htmlFor="s4-name" className={styles.label}>{t('step4.name_label')}</label>
          <input
            id="s4-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('step4.name_placeholder')}
            className={styles.input}
            autoFocus
          />
        </div>

        {[
          { id: 's4-street', key: 'street', label: t('step4.street_label'), ph: t('step4.street_placeholder'), val: street, set: (v: string) => { setStreet(v); resetVerification(); } },
          { id: 's4-city',   key: 'city',   label: t('step4.city_label'),   ph: t('step4.city_placeholder'),   val: city,   set: (v: string) => { setCity(v);   resetVerification(); } },
          { id: 's4-postal', key: 'postal', label: t('step4.postal_label'), ph: t('step4.postal_placeholder'), val: postal, set: (v: string) => { setPostal(v); resetVerification(); } },
        ].map(({ id, label, ph, val, set }) => (
          <div key={id} className={styles.field}>
            <label htmlFor={id} className={styles.label}>{label} *</label>
            <input
              id={id}
              type="text"
              required
              value={val}
              onChange={(e) => set(e.target.value)}
              placeholder={ph}
              className={styles.input}
            />
          </div>
        ))}

        {/* Verify button */}
        {geoState !== 'verified' && (
          <button
            type="button"
            className={styles.continueBtn}
            style={{ alignSelf: 'flex-start' }}
            disabled={!canVerify || geoState === 'verifying'}
            onClick={handleVerify}
          >
            {geoState === 'verifying' ? t('step4.verifying') : t('step4.verify_btn')}
          </button>
        )}

        {geoState === 'verified' && lat !== null && (
          <div className={styles.verifiedRow}>
            {t('step4.verified')} &nbsp;· lat: {lat.toFixed(4)}, lng: {lng!.toFixed(4)}
          </div>
        )}

        {geoState === 'error' && (
          <p className={styles.error}>{geoError}</p>
        )}

        {/* Lazy-loaded Leaflet map fallback */}
        {showMap && (
          <Suspense fallback={<div className={styles.hint}>Loading map…</div>}>
            <LeafletMap
              hint={t('step4.map_hint')}
              initialLat={lat ?? 49.2}
              initialLng={lng ?? 16.6}
              onPinMoved={(newLat, newLng) => {
                setLat(newLat);
                setLng(newLng);
                setGeoState('verified');
              }}
            />
          </Suspense>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.backBtn} onClick={goBack}>
            {t('step4.back')}
          </button>
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={isSubmitting || geoState !== 'verified'}
          >
            {isSubmitting ? t('step4.submitting') : t('step4.continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
