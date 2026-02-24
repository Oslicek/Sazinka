import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useWizard } from './OnboardingWizard';
import styles from './Step.module.css';

interface BuiltinType {
  key: string;
  labelKey: string;
  defaultDuration: number;
  defaultInterval: number;
}

const BUILTINS: BuiltinType[] = [
  { key: 'chimney',          labelKey: 'step3.chimney',          defaultDuration: 30, defaultInterval: 12 },
  { key: 'gas_boiler',       labelKey: 'step3.gas_boiler',       defaultDuration: 60, defaultInterval: 12 },
  { key: 'gas_water_heater', labelKey: 'step3.gas_water_heater', defaultDuration: 45, defaultInterval: 12 },
  { key: 'fireplace',        labelKey: 'step3.fireplace',        defaultDuration: 30, defaultInterval: 12 },
  { key: 'gas_stove',        labelKey: 'step3.gas_stove',        defaultDuration: 20, defaultInterval: 36 },
];

interface Override {
  duration: number;
  interval: number;
}

interface CustomType {
  label: string;
  duration: number;
  interval: number;
}

export function Step3Devices() {
  const { t } = useTranslation('onboarding');
  const { setStep, setDeviceTypeCount, goBack } = useWizard();
  const request = useNatsStore((s) => s.request);

  const [selected, setSelected] = useState<Set<string>>(new Set(['chimney']));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [customTypes, setCustomTypes] = useState<CustomType[]>([]);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newCustom, setNewCustom] = useState<CustomType>({ label: '', duration: 30, interval: 12 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!selected.has(key)) {
      const bt = BUILTINS.find((b) => b.key === key)!;
      setOverrides((prev) => ({
        ...prev,
        [key]: { duration: bt.defaultDuration, interval: bt.defaultInterval },
      }));
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  const setOverride = (key: string, field: 'duration' | 'interval', value: number) => {
    setOverrides((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const addCustomType = () => {
    if (!newCustom.label) return;
    setCustomTypes((prev) => [...prev, newCustom]);
    setNewCustom({ label: '', duration: 30, interval: 12 });
    setShowAddCustom(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) {
      setError(t('step3.at_least_one'));
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const selectedBuiltins = BUILTINS
        .filter((b) => selected.has(b.key))
        .map((b) => ({
          deviceTypeKey: b.key,
          defaultRevisionDurationMinutes: overrides[b.key]?.duration ?? b.defaultDuration,
          defaultRevisionIntervalMonths:  overrides[b.key]?.interval ?? b.defaultInterval,
        }));

      await request('sazinka.onboarding.devices', {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        payload: { selectedBuiltins, customTypes },
      });

      setDeviceTypeCount(selectedBuiltins.length + customTypes.length);
      setStep(4);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>{t('step3.title')}</h2>
      <p className={styles.subtitle}>{t('step3.subtitle')}</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.checkboxList}>
          {BUILTINS.map((bt) => {
            const isChecked = selected.has(bt.key);
            const isOpen = expanded === bt.key && isChecked;
            const ov = overrides[bt.key] ?? { duration: bt.defaultDuration, interval: bt.defaultInterval };

            return (
              <div key={bt.key}>
                <div
                  className={styles.checkboxRow}
                  onClick={() => toggleSelect(bt.key)}
                  role="checkbox"
                  aria-checked={isChecked}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && toggleSelect(bt.key)}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(bt.key)}
                    onClick={(e) => e.stopPropagation()}
                    className={styles.checkbox}
                  />
                  <div className={styles.rowMeta}>
                    <span className={styles.rowName}>{t(bt.labelKey)}</span>
                    <span className={styles.rowDefaults}>
                      {ov.duration} {t('step3.minutes')} · {t('step3.interval_label')}: {ov.interval} {t('step3.months')}
                    </span>
                  </div>
                  {isChecked && (
                    <button
                      type="button"
                      className={styles.expandBtn}
                      onClick={(e) => { e.stopPropagation(); toggleExpand(bt.key); }}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                      {isOpen ? '▴' : '▾'}
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className={styles.expandPanel}>
                    <div className={styles.expandField}>
                      <label className={styles.expandLabel}>{t('step3.duration_label')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="number"
                          min={5}
                          max={480}
                          value={ov.duration}
                          onChange={(e) => setOverride(bt.key, 'duration', +e.target.value)}
                          className={styles.expandInput}
                        />
                        <span className={styles.expandUnit}>{t('step3.minutes')}</span>
                      </div>
                    </div>
                    <div className={styles.expandField}>
                      <label className={styles.expandLabel}>{t('step3.interval_label')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={ov.interval}
                          onChange={(e) => setOverride(bt.key, 'interval', +e.target.value)}
                          className={styles.expandInput}
                        />
                        <span className={styles.expandUnit}>{t('step3.months')}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Custom types already added */}
        {customTypes.map((ct, i) => (
          <div key={i} className={styles.checkboxRow} style={{ opacity: 0.85 }}>
            <input type="checkbox" checked readOnly className={styles.checkbox} />
            <div className={styles.rowMeta}>
              <span className={styles.rowName}>{ct.label}</span>
              <span className={styles.rowDefaults}>
                {ct.duration} {t('step3.minutes')} · {ct.interval} {t('step3.months')}
              </span>
            </div>
          </div>
        ))}

        {/* Add custom type */}
        {showAddCustom ? (
          <div className={styles.expandPanel} style={{ marginTop: 8 }}>
            <div className={styles.expandField} style={{ flex: 1 }}>
              <label className={styles.expandLabel}>{t('step3.custom_label')}</label>
              <input
                type="text"
                value={newCustom.label}
                onChange={(e) => setNewCustom((p) => ({ ...p, label: e.target.value }))}
                placeholder={t('step3.custom_label_placeholder')}
                className={styles.expandInput}
                style={{ width: '100%' }}
                autoFocus
              />
            </div>
            <div className={styles.expandField}>
              <label className={styles.expandLabel}>{t('step3.duration_label')}</label>
              <input
                type="number"
                min={5}
                value={newCustom.duration}
                onChange={(e) => setNewCustom((p) => ({ ...p, duration: +e.target.value }))}
                className={styles.expandInput}
              />
            </div>
            <div className={styles.expandField}>
              <label className={styles.expandLabel}>{t('step3.interval_label')}</label>
              <input
                type="number"
                min={1}
                value={newCustom.interval}
                onChange={(e) => setNewCustom((p) => ({ ...p, interval: +e.target.value }))}
                className={styles.expandInput}
              />
            </div>
            <button type="button" className={styles.continueBtn} style={{ marginTop: 'auto' }} onClick={addCustomType}>
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.backBtn}
            style={{ alignSelf: 'flex-start', fontSize: '0.875rem' }}
            onClick={() => setShowAddCustom(true)}
          >
            {t('step3.add_custom')}
          </button>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.backBtn} onClick={goBack}>
            {t('step3.back')}
          </button>
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={isSubmitting || selected.size === 0}
          >
            {isSubmitting ? t('step3.submitting') : t('step3.continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
