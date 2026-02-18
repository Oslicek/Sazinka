import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as deviceTypeConfigService from '../../services/deviceTypeConfigService';
import type {
  DeviceTypeConfig,
  DeviceTypeField,
  CreateDeviceTypeFieldRequest,
  SelectOption,
} from '@shared/deviceTypeConfig';
import styles from './DeviceTypeConfigManager.module.css';

// ── helpers ──────────────────────────────────────────────────────────────────

const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select'] as const;

function fieldTypeLabel(t: (k: string) => string, type: string): string {
  const map: Record<string, string> = {
    text: t('dt_field_type_text'),
    number: t('dt_field_type_number'),
    date: t('dt_field_type_date'),
    boolean: t('dt_field_type_boolean'),
    select: t('dt_field_type_select'),
  };
  return map[type] ?? type;
}

// ── sub-components ────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: DeviceTypeField;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: () => void;
  onSaveField: (patch: Partial<DeviceTypeField>) => Promise<void>;
  saving: boolean;
}

function FieldRow({
  field,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onToggleActive,
  onSaveField,
  saving,
}: FieldRowProps) {
  const { t } = useTranslation('settings');
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.label);
  const [isRequired, setIsRequired] = useState(field.isRequired);
  const [unit, setUnit] = useState(field.unit ?? '');
  const [placeholder, setPlaceholder] = useState(field.placeholder ?? '');
  const [selectOptions, setSelectOptions] = useState<SelectOption[]>(
    field.selectOptions ?? []
  );
  const [newOptionKey, setNewOptionKey] = useState('');
  const [newOptionLabel, setNewOptionLabel] = useState('');

  const handleSave = async () => {
    const patch: Partial<DeviceTypeField> = { label, isRequired };
    if (field.fieldType === 'number') patch.unit = unit || undefined;
    if (field.fieldType === 'text' || field.fieldType === 'number')
      patch.placeholder = placeholder || undefined;
    if (field.fieldType === 'select') patch.selectOptions = selectOptions;
    await onSaveField(patch);
    setEditing(false);
  };

  const handleCancel = () => {
    setLabel(field.label);
    setIsRequired(field.isRequired);
    setUnit(field.unit ?? '');
    setPlaceholder(field.placeholder ?? '');
    setSelectOptions(field.selectOptions ?? []);
    setEditing(false);
  };

  const handleAddOption = () => {
    if (!newOptionKey.trim() || !newOptionLabel.trim()) return;
    setSelectOptions((prev) => [
      ...prev,
      { key: newOptionKey.trim(), label: newOptionLabel.trim(), isDeprecated: false },
    ]);
    setNewOptionKey('');
    setNewOptionLabel('');
  };

  const handleDeprecateOption = (key: string) => {
    setSelectOptions((prev) =>
      prev.map((o) => (o.key === key ? { ...o, isDeprecated: !o.isDeprecated } : o))
    );
  };

  return (
    <div className={`${styles.fieldRow} ${!field.isActive ? styles.fieldInactive : ''}`}>
      <div className={styles.fieldHeader}>
        <div className={styles.fieldInfo}>
          <span className={styles.fieldLabel}>{field.label}</span>
          <span className={styles.fieldMeta}>
            {fieldTypeLabel(t, field.fieldType)}
            {field.fieldKey ? ` · ${field.fieldKey}` : ''}
            {field.isRequired ? ` · ${t('dt_required')}` : ''}
          </span>
          {!field.isActive && (
            <span className={styles.fieldInactiveBadge}>{t('dt_inactive')}</span>
          )}
        </div>
        <div className={styles.fieldActions}>
          <button
            className={styles.orderBtn}
            onClick={onMoveUp}
            disabled={index === 0 || saving}
            title={t('dt_move_up')}
          >
            ↑
          </button>
          <button
            className={styles.orderBtn}
            onClick={onMoveDown}
            disabled={index === total - 1 || saving}
            title={t('dt_move_down')}
          >
            ↓
          </button>
          <button
            className={styles.editFieldBtn}
            onClick={() => setEditing(true)}
            disabled={saving}
          >
            {t('edit')}
          </button>
          <button
            className={field.isActive ? styles.deactivateBtn : styles.activateBtn}
            onClick={onToggleActive}
            disabled={saving}
          >
            {field.isActive ? t('dt_deactivate') : t('dt_reactivate')}
          </button>
        </div>
      </div>

      {editing && (
        <div className={styles.fieldEditPanel}>
          <div className={styles.formRow}>
            <label className={styles.label}>{t('dt_field_label')}</label>
            <input
              className={styles.input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>{t('dt_field_required')}</label>
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
            />
          </div>
          {(field.fieldType === 'text' || field.fieldType === 'number') && (
            <div className={styles.formRow}>
              <label className={styles.label}>{t('dt_field_placeholder')}</label>
              <input
                className={styles.input}
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
              />
            </div>
          )}
          {field.fieldType === 'number' && (
            <div className={styles.formRow}>
              <label className={styles.label}>{t('dt_field_unit')}</label>
              <input
                className={styles.input}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          )}
          {field.fieldType === 'select' && (
            <div className={styles.optionsSection}>
              <p className={styles.optionsSectionLabel}>{t('dt_select_options')}</p>
              {selectOptions.map((opt) => (
                <div key={opt.key} className={styles.optionRow}>
                  <span className={`${styles.optionKey} ${opt.isDeprecated ? styles.deprecated : ''}`}>
                    {opt.key}
                  </span>
                  <span className={`${styles.optionLabel} ${opt.isDeprecated ? styles.deprecated : ''}`}>
                    {opt.label}
                  </span>
                  <button
                    type="button"
                    className={styles.deprecateBtn}
                    onClick={() => handleDeprecateOption(opt.key)}
                  >
                    {opt.isDeprecated ? t('dt_restore') : t('dt_deprecate')}
                  </button>
                </div>
              ))}
              <div className={styles.addOptionRow}>
                <input
                  className={styles.inputSmall}
                  placeholder={t('dt_option_key_placeholder')}
                  value={newOptionKey}
                  onChange={(e) => setNewOptionKey(e.target.value)}
                />
                <input
                  className={styles.inputSmall}
                  placeholder={t('dt_option_label_placeholder')}
                  value={newOptionLabel}
                  onChange={(e) => setNewOptionLabel(e.target.value)}
                />
                <button type="button" className={styles.addOptionBtn} onClick={handleAddOption}>
                  {t('dt_add_option')}
                </button>
              </div>
            </div>
          )}
          <div className={styles.editActions}>
            <button className="btn-primary" onClick={handleSave} disabled={saving || !label.trim()}>
              {saving ? t('saving') : t('save_changes')}
            </button>
            <button className={styles.cancelBtn} onClick={handleCancel} disabled={saving}>
              {t('common:cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AddFieldForm ──────────────────────────────────────────────────────────────

interface AddFieldFormProps {
  deviceTypeConfigId: string;
  onCreated: (field: DeviceTypeField) => void;
  onCancel: () => void;
  saving: boolean;
}

function AddFieldForm({ deviceTypeConfigId, onCreated, onCancel, saving }: AddFieldFormProps) {
  const { t } = useTranslation('settings');
  const [fieldKey, setFieldKey] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<CreateDeviceTypeFieldRequest['fieldType']>('text');
  const [isRequired, setIsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!fieldKey.trim() || !label.trim()) {
      setError(t('dt_field_error_required'));
      return;
    }
    setError(null);
    try {
      const created = await deviceTypeConfigService.createDeviceTypeField({
        deviceTypeConfigId,
        fieldKey: fieldKey.trim(),
        label: label.trim(),
        fieldType,
        isRequired,
        sortOrder: 999,
      });
      onCreated(created);
    } catch {
      setError(t('dt_field_error_create'));
    }
  };

  return (
    <div className={styles.addFieldForm}>
      <h4 className={styles.addFieldTitle}>{t('dt_add_field')}</h4>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.formRow}>
        <label className={styles.label}>{t('dt_field_key')}</label>
        <input
          className={styles.input}
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          placeholder={t('dt_field_key_placeholder')}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.label}>{t('dt_field_label')}</label>
        <input
          className={styles.input}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.label}>{t('dt_field_type')}</label>
        <select
          className={styles.select}
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as typeof fieldType)}
        >
          {FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {fieldTypeLabel(t, ft)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.formRow}>
        <label className={styles.label}>{t('dt_field_required')}</label>
        <input
          type="checkbox"
          checked={isRequired}
          onChange={(e) => setIsRequired(e.target.checked)}
        />
      </div>
      <div className={styles.editActions}>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? t('saving') : t('dt_field_create')}
        </button>
        <button className={styles.cancelBtn} onClick={onCancel}>
          {t('common:cancel')}
        </button>
      </div>
    </div>
  );
}

// ── DeviceTypeCard ────────────────────────────────────────────────────────────

interface DeviceTypeCardProps {
  config: DeviceTypeConfig;
  onUpdated: (updated: DeviceTypeConfig) => void;
}

function DeviceTypeCard({ config, onUpdated }: DeviceTypeCardProps) {
  const { t } = useTranslation('settings');
  const [expanded, setExpanded] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [label, setLabel] = useState(config.label);
  const [duration, setDuration] = useState(config.defaultRevisionDurationMinutes);
  const [interval, setInterval] = useState(config.defaultRevisionIntervalMonths);
  const [fields, setFields] = useState<DeviceTypeField[]>(config.fields ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddField, setShowAddField] = useState(false);

  const handleToggleActive = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await deviceTypeConfigService.updateDeviceTypeConfig({
        id: config.id,
        isActive: !config.isActive,
      });
      onUpdated(updated);
      setFields(updated.fields);
    } catch {
      setError('dt_error_update');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMeta = async () => {
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await deviceTypeConfigService.updateDeviceTypeConfig({
        id: config.id,
        label: label.trim(),
        defaultRevisionDurationMinutes: duration,
        defaultRevisionIntervalMonths: interval,
      });
      onUpdated(updated);
      setFields(updated.fields);
      setEditingMeta(false);
    } catch {
      setError('dt_error_update');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelMeta = () => {
    setLabel(config.label);
    setDuration(config.defaultRevisionDurationMinutes);
    setInterval(config.defaultRevisionIntervalMonths);
    setEditingMeta(false);
  };

  const handleSaveField = async (field: DeviceTypeField, patch: Partial<DeviceTypeField>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await deviceTypeConfigService.updateDeviceTypeField({ id: field.id, ...patch });
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch {
      setError('dt_error_update');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFieldActive = async (field: DeviceTypeField) => {
    setSaving(true);
    setError(null);
    try {
      await deviceTypeConfigService.setFieldActive({ id: field.id, isActive: !field.isActive });
      setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, isActive: !f.isActive } : f)));
    } catch {
      setError('dt_error_update');
    } finally {
      setSaving(false);
    }
  };

  const handleReorder = async (fromIndex: number, toIndex: number) => {
    const newFields = [...fields];
    const [moved] = newFields.splice(fromIndex, 1);
    newFields.splice(toIndex, 0, moved);
    setFields(newFields);
    setSaving(true);
    setError(null);
    try {
      await deviceTypeConfigService.reorderFields({
        deviceTypeConfigId: config.id,
        fieldIds: newFields.map((f) => f.id),
      });
    } catch {
      setError('dt_error_update');
      setFields(fields);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldCreated = (field: DeviceTypeField) => {
    setFields((prev) => [...prev, field]);
    setShowAddField(false);
  };

  const activeFields = fields.filter((f) => f.isActive);
  const inactiveFields = fields.filter((f) => !f.isActive);
  const sortedFields = [...activeFields, ...inactiveFields];

  return (
    <div className={`${styles.card} ${!config.isActive ? styles.cardInactive : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <button
            className={styles.expandBtn}
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            <span className={styles.expandArrow}>{expanded ? '▾' : '▸'}</span>
            <span className={styles.configLabel}>{config.label}</span>
            <span className={styles.configKey}>{config.deviceTypeKey}</span>
            {!config.isActive && (
              <span className={styles.inactiveBadge}>{t('dt_inactive')}</span>
            )}
          </button>
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.metaItem}>
            {t('dt_duration')}: {config.defaultRevisionDurationMinutes} {t('dt_min')}
          </span>
          <span className={styles.metaItem}>
            {t('dt_interval')}: {config.defaultRevisionIntervalMonths} {t('dt_months')}
          </span>
          <span className={styles.metaItem}>
            {t('dt_fields_count', { count: activeFields.length })}
          </span>
        </div>
        <div className={styles.cardActions}>
          <button
            className={styles.editMetaBtn}
            onClick={() => { setEditingMeta(true); setExpanded(true); }}
            disabled={saving}
          >
            {t('edit')}
          </button>
          <button
            className={config.isActive ? styles.deactivateBtn : styles.activateBtn}
            onClick={handleToggleActive}
            disabled={saving}
          >
            {config.isActive ? t('dt_deactivate') : t('dt_reactivate')}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {editingMeta && (
        <div className={styles.metaEditPanel}>
          <div className={styles.formRow}>
            <label className={styles.label}>{t('dt_label')}</label>
            <input
              className={styles.input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>{t('dt_default_duration')}</label>
            <input
              className={styles.inputNumber}
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
            <span className={styles.unitSuffix}>{t('dt_min')}</span>
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>{t('dt_default_interval')}</label>
            <input
              className={styles.inputNumber}
              type="number"
              min={1}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
            <span className={styles.unitSuffix}>{t('dt_months')}</span>
          </div>
          <div className={styles.editActions}>
            <button
              className="btn-primary"
              onClick={handleSaveMeta}
              disabled={saving || !label.trim()}
            >
              {saving ? t('saving') : t('save_changes')}
            </button>
            <button className={styles.cancelBtn} onClick={handleCancelMeta} disabled={saving}>
              {t('common:cancel')}
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className={styles.fieldsSection}>
          <div className={styles.fieldsSectionHeader}>
            <h4 className={styles.fieldsSectionTitle}>{t('dt_fields')}</h4>
            {!showAddField && (
              <button
                className={styles.addFieldBtn}
                onClick={() => setShowAddField(true)}
                disabled={saving}
              >
                {t('dt_add_field')}
              </button>
            )}
          </div>

          {showAddField && (
            <AddFieldForm
              deviceTypeConfigId={config.id}
              onCreated={handleFieldCreated}
              onCancel={() => setShowAddField(false)}
              saving={saving}
            />
          )}

          {sortedFields.length === 0 ? (
            <p className={styles.emptyFields}>{t('dt_no_fields')}</p>
          ) : (
            sortedFields.map((field, idx) => (
              <FieldRow
                key={field.id}
                field={field}
                index={idx}
                total={sortedFields.length}
                onMoveUp={() => handleReorder(idx, idx - 1)}
                onMoveDown={() => handleReorder(idx, idx + 1)}
                onToggleActive={() => handleToggleFieldActive(field)}
                onSaveField={(patch) => handleSaveField(field, patch)}
                saving={saving}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DeviceTypeConfigManagerProps {
  onUpdate?: () => void;
}

export function DeviceTypeConfigManager({ onUpdate }: DeviceTypeConfigManagerProps) {
  const { t } = useTranslation('settings');
  const [configs, setConfigs] = useState<DeviceTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await deviceTypeConfigService.listDeviceTypeConfigs({
        includeInactive: true,
      });
      setConfigs(list);
    } catch {
      setError('dt_error_load');
    } finally {
      setLoading(false);
    }
    // t is intentionally omitted — i18next's t is stable after init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleUpdated = (updated: DeviceTypeConfig) => {
    setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    onUpdate?.();
  };

  const visibleConfigs = showInactive
    ? configs
    : configs.filter((c) => c.isActive);

  return (
    <div className={styles.manager}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{t('dt_title')}</h2>
        <label className={styles.toggleInactive}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t('dt_show_inactive')}
        </label>
      </div>

      <p className={styles.sectionDescription}>{t('dt_description')}</p>

      {loading && <div className={styles.loading}>{t('loading')}</div>}
      {error && (
        <div className={styles.error}>
          {error}
          <button className={styles.retryBtn} onClick={loadConfigs}>
            {t('retry')}
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className={styles.configList}>
          {visibleConfigs.length === 0 ? (
            <p className={styles.emptyState}>{t('dt_empty')}</p>
          ) : (
            visibleConfigs.map((config) => (
              <DeviceTypeCard key={config.id} config={config} onUpdated={handleUpdated} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default DeviceTypeConfigManager;
