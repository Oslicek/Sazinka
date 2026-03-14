import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '../../stores/natsStore';
import {
  listRuleSets,
  createRuleSet,
  updateRuleSet,
  archiveRuleSet,
  setDefaultRuleSet,
  deleteRuleSet,
  restoreRuleSetDefaults,
} from '../../services/scoringService';
import type { ScoringRuleSet, FactorInput } from '../../services/scoringService';
import { FACTOR_KEYS } from '@shared/scoring';
import styles from './ScoringRuleSetsManager.module.css';

// Sorting factors (control primary inbox order via lifecycle_rank, due date, age)
const SORTING_FACTOR_KEYS = [
  FACTOR_KEYS.LIFECYCLE_RANK,
  FACTOR_KEYS.DAYS_UNTIL_DUE,
  FACTOR_KEYS.CUSTOMER_AGE_DAYS,
] as const;

// Urgency factors (fine-tune priority within lifecycle groups)
const URGENCY_FACTOR_KEYS = [
  FACTOR_KEYS.OVERDUE_DAYS,
  FACTOR_KEYS.GEOCODE_FAILED,
  FACTOR_KEYS.TOTAL_COMMUNICATIONS,
  FACTOR_KEYS.DAYS_SINCE_LAST_CONTACT,
  FACTOR_KEYS.NO_OPEN_ACTION,
] as const;

const ALL_FACTOR_KEYS = [...SORTING_FACTOR_KEYS, ...URGENCY_FACTOR_KEYS] as const;

function defaultFactors(): FactorInput[] {
  return ALL_FACTOR_KEYS.map((key) => ({ factorKey: key, weight: 0 }));
}

interface EditState {
  id?: string;
  name: string;
  description: string;
  isDefault: boolean;
  factors: FactorInput[];
}

function emptyEdit(): EditState {
  return { name: '', description: '', isDefault: false, factors: defaultFactors() };
}

export function ScoringRuleSetsManager() {
  const { t } = useTranslation('settings');
  const { isConnected } = useNatsStore();
  const [ruleSets, setRuleSets] = useState<ScoringRuleSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [editState, setEditState] = useState<EditState>(emptyEdit());
  const [saving, setSaving] = useState(false);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const load = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    setError(null);
    try {
      const sets = await listRuleSets(showArchived);
      setRuleSets(sets);
    } catch {
      setError(t('scoring_error_load'));
    } finally {
      setLoading(false);
    }
  }, [isConnected, showArchived, t]);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setEditingId('new');
    setEditState(emptyEdit());
  };

  const startEdit = (rs: ScoringRuleSet) => {
    setEditingId(rs.id);
    setEditState({
      id: rs.id,
      name: rs.name,
      description: rs.description ?? '',
      isDefault: rs.isDefault,
      factors: defaultFactors(),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditState(emptyEdit());
  };

  const handleSave = async () => {
    if (!editState.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId === 'new') {
        await createRuleSet({
          name: editState.name.trim(),
          description: editState.description.trim() || null,
          isDefault: editState.isDefault,
          factors: editState.factors.filter((f) => f.weight !== 0),
        });
      } else if (editingId) {
        await updateRuleSet({
          id: editingId,
          name: editState.name.trim(),
          description: editState.description.trim() || null,
          isDefault: editState.isDefault,
          factors: editState.factors.filter((f) => f.weight !== 0),
        });
      }
      showSuccess(t('scoring_success_save'));
      cancelEdit();
      await load();
    } catch {
      setError(t('scoring_error_save'));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveRuleSet(id);
      showSuccess(t('scoring_success_archive'));
      await load();
    } catch {
      setError(t('scoring_error_archive'));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultRuleSet(id);
      showSuccess(t('scoring_success_set_default'));
      await load();
    } catch {
      setError(t('scoring_error_set_default'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRuleSet(id);
      showSuccess(t('scoring_success_delete'));
      await load();
    } catch {
      setError(t('scoring_error_delete'));
    }
  };

  const handleRestoreDefaults = async (id: string) => {
    if (!window.confirm(t('scoring_restore_defaults_confirm'))) return;
    try {
      await restoreRuleSetDefaults(id);
      showSuccess(t('scoring_restore_defaults_success'));
      await load();
    } catch {
      setError(t('scoring_error_restore_defaults'));
    }
  };

  const setFactorWeight = (factorKey: string, weight: number) => {
    setEditState((prev) => ({
      ...prev,
      factors: prev.factors.map((f) =>
        f.factorKey === factorKey ? { ...f, weight } : f
      ),
    }));
  };

  const factorLabel = (key: string): string => {
    const map: Record<string, string> = {
      [FACTOR_KEYS.LIFECYCLE_RANK]: t('scoring_factor_lifecycle_rank'),
      [FACTOR_KEYS.DAYS_UNTIL_DUE]: t('scoring_factor_days_until_due'),
      [FACTOR_KEYS.CUSTOMER_AGE_DAYS]: t('scoring_factor_customer_age_days'),
      [FACTOR_KEYS.OVERDUE_DAYS]: t('scoring_factor_overdue_days'),
      [FACTOR_KEYS.GEOCODE_FAILED]: t('scoring_factor_geocode_failed'),
      [FACTOR_KEYS.TOTAL_COMMUNICATIONS]: t('scoring_factor_total_communications'),
      [FACTOR_KEYS.DAYS_SINCE_LAST_CONTACT]: t('scoring_factor_days_since_last_contact'),
      [FACTOR_KEYS.NO_OPEN_ACTION]: t('scoring_factor_no_open_action'),
    };
    return map[key] ?? key;
  };

  const visible = ruleSets.filter((rs) => showArchived || !rs.isArchived);

  return (
    <div className={styles.manager}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('scoring_title')}</h2>
          <p className={styles.description}>{t('scoring_description')}</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.archivedToggle}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('scoring_show_archived')}
          </label>
          <button className={styles.newBtn} onClick={startNew} disabled={editingId !== null}>
            {t('scoring_new_profile')}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.successMsg}>{success}</div>}

      {loading && <div className={styles.loading}>…</div>}

      {!loading && visible.length === 0 && editingId !== 'new' && (
        <p className={styles.empty}>{t('scoring_no_profiles')}</p>
      )}

      {editingId === 'new' && (
        <RuleSetForm
          state={editState}
          onChange={setEditState}
          onFactorChange={setFactorWeight}
          onSave={handleSave}
          onCancel={cancelEdit}
          saving={saving}
          factorLabel={factorLabel}
          sortingFactorKeys={SORTING_FACTOR_KEYS as unknown as string[]}
          urgencyFactorKeys={URGENCY_FACTOR_KEYS as unknown as string[]}
          t={t}
        />
      )}

      <ul className={styles.list}>
        {visible.map((rs) => (
          <li key={rs.id} className={`${styles.item} ${rs.isArchived ? styles.archived : ''}`}>
            {editingId === rs.id ? (
              <RuleSetForm
                state={editState}
                onChange={setEditState}
                onFactorChange={setFactorWeight}
                onSave={handleSave}
                onCancel={cancelEdit}
                saving={saving}
                factorLabel={factorLabel}
                sortingFactorKeys={SORTING_FACTOR_KEYS as unknown as string[]}
                urgencyFactorKeys={URGENCY_FACTOR_KEYS as unknown as string[]}
                t={t}
              />
            ) : (
              <div className={styles.itemRow}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{rs.name}</span>
                  {rs.isSystem && (
                    <span className={`${styles.badge} ${styles.badgeSystem}`}>
                      {t('scoring_system_badge')}
                    </span>
                  )}
                  {rs.isDefault && (
                    <span className={styles.badge}>{t('scoring_default_badge')}</span>
                  )}
                  {rs.isArchived && (
                    <span className={`${styles.badge} ${styles.badgeArchived}`}>
                      {t('scoring_archived_badge')}
                    </span>
                  )}
                  {rs.description && (
                    <span className={styles.itemDesc}>{rs.description}</span>
                  )}
                </div>
                <div className={styles.itemActions}>
                  {!rs.isArchived && !rs.isDefault && (
                    <button
                      className={styles.actionBtn}
                      onClick={() => handleSetDefault(rs.id)}
                    >
                      {t('scoring_set_default')}
                    </button>
                  )}
                  {!rs.isArchived && (
                    <button
                      className={styles.actionBtn}
                      onClick={() => startEdit(rs)}
                    >
                      {t('scoring_edit')}
                    </button>
                  )}
                  {rs.isSystem && !rs.isArchived && (
                    <button
                      className={styles.actionBtn}
                      onClick={() => handleRestoreDefaults(rs.id)}
                    >
                      {t('scoring_restore_defaults')}
                    </button>
                  )}
                  {!rs.isArchived && (
                    <button
                      className={`${styles.actionBtn} ${styles.dangerBtn}`}
                      onClick={() => handleArchive(rs.id)}
                    >
                      {t('scoring_archive')}
                    </button>
                  )}
                  {!rs.isSystem && rs.isArchived && (
                    <button
                      className={`${styles.actionBtn} ${styles.dangerBtn}`}
                      onClick={() => handleDelete(rs.id)}
                    >
                      {t('delete_action')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FormProps {
  state: EditState;
  onChange: (s: EditState) => void;
  onFactorChange: (key: string, weight: number) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  factorLabel: (key: string) => string;
  sortingFactorKeys: string[];
  urgencyFactorKeys: string[];
  t: (key: string) => string;
}

function FactorGroup({
  title,
  hint,
  factorKeys,
  factors,
  factorLabel,
  onFactorChange,
}: {
  title: string;
  hint: string;
  factorKeys: string[];
  factors: FactorInput[];
  factorLabel: (key: string) => string;
  onFactorChange: (key: string, weight: number) => void;
}) {
  return (
    <div>
      <h5 className="">{title}</h5>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary, #888)', marginBottom: '0.5rem' }}>{hint}</p>
      {factorKeys.map((key) => {
        const factor = factors.find((f) => f.factorKey === key);
        const weight = factor?.weight ?? 0;
        const isWide = key === 'lifecycle_rank'; // lifecycle_rank needs wider range
        const min = isWide ? -1200 : -100;
        const max = isWide ? 0 : 100;
        const step = isWide ? 50 : 1;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span style={{ flex: 1, fontSize: '0.85rem' }}>{factorLabel(key)}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={weight}
              onChange={(e) => onFactorChange(key, Number(e.target.value))}
              style={{ width: '120px' }}
            />
            <span style={{ width: '60px', textAlign: 'right', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
              {weight > 0 ? `+${weight}` : weight}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RuleSetForm({
  state, onChange, onFactorChange, onSave, onCancel,
  saving, factorLabel, sortingFactorKeys, urgencyFactorKeys, t,
}: FormProps) {
  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <label className={styles.label}>{t('scoring_name_label')}</label>
        <input
          className={styles.input}
          value={state.name}
          onChange={(e) => onChange({ ...state, name: e.target.value })}
          placeholder={t('scoring_name_placeholder')}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.label}>{t('scoring_description_label')}</label>
        <input
          className={styles.input}
          value={state.description}
          onChange={(e) => onChange({ ...state, description: e.target.value })}
          placeholder={t('scoring_description_placeholder')}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={state.isDefault}
            onChange={(e) => onChange({ ...state, isDefault: e.target.checked })}
          />
          {t('scoring_default_badge')}
        </label>
      </div>

      <div className={styles.factorsSection}>
        <h4 className={styles.factorsTitle}>{t('scoring_factors_title')}</h4>
        <p className={styles.factorsHint}>{t('scoring_factors_hint')}</p>

        <FactorGroup
          title={t('scoring_factors_group_sorting')}
          hint={t('scoring_factors_group_sorting_hint')}
          factorKeys={sortingFactorKeys}
          factors={state.factors}
          factorLabel={factorLabel}
          onFactorChange={onFactorChange}
        />

        <FactorGroup
          title={t('scoring_factors_group_urgency')}
          hint={t('scoring_factors_group_urgency_hint')}
          factorKeys={urgencyFactorKeys}
          factors={state.factors}
          factorLabel={factorLabel}
          onFactorChange={onFactorChange}
        />
      </div>

      <div className={styles.formActions}>
        <button className={styles.saveBtn} onClick={onSave} disabled={saving || !state.name.trim()}>
          {saving ? '…' : t('scoring_save')}
        </button>
        <button className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          {t('scoring_cancel')}
        </button>
      </div>
    </div>
  );
}
