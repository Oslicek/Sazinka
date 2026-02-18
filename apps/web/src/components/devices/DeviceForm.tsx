import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, CreateDeviceRequest } from '@shared/device';
import type { DeviceTypeConfig, DeviceTypeField } from '@shared/deviceTypeConfig';
import { DEVICE_TYPE_KEYS } from '@shared/device';
import { createDevice, updateDevice, type UpdateDeviceRequest } from '../../services/deviceService';
import {
  listDeviceTypeConfigs,
  getDeviceTypeConfig,
} from '../../services/deviceTypeConfigService';
import { useNatsStore } from '../../stores/natsStore';
import { DynamicFieldRenderer, decodeValueJson, encodeValueJson } from './DynamicFieldRenderer';
import styles from './DeviceForm.module.css';

interface DeviceFormProps {
  customerId: string;
  device?: Device;
  onSuccess: () => void;
  onCancel: () => void;
}

interface FormData {
  deviceTypeConfigId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  installationDate: string;
  revisionIntervalMonths: number;
  notes: string;
}

const createInitialFormData = (device?: Device): FormData => ({
  deviceTypeConfigId: device?.deviceTypeConfigId ?? '',
  manufacturer: device?.manufacturer ?? '',
  model: device?.model ?? '',
  serialNumber: device?.serialNumber ?? '',
  installationDate: device?.installationDate ?? '',
  revisionIntervalMonths: device?.revisionIntervalMonths ?? 12,
  notes: device?.notes ?? '',
});

export function DeviceForm({ customerId, device, onSuccess, onCancel }: DeviceFormProps) {
  const { t } = useTranslation('common');
  const isEditMode = !!device;
  const [formData, setFormData] = useState<FormData>(() => createInitialFormData(device));

  // configs for the type selector (create mode)
  const [configs, setConfigs] = useState<DeviceTypeConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(!isEditMode);

  // selected config and its fields
  const [selectedConfig, setSelectedConfig] = useState<DeviceTypeConfig | null>(null);
  const [fields, setFields] = useState<DeviceTypeField[]>([]);
  // custom field values: fieldId → display string
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    if (!device?.customFields) return {};
    return Object.fromEntries(
      (device.customFields ?? []).map((cfv) => [
        cfv.fieldId,
        decodeValueJson(cfv.valueJson, cfv.field?.fieldType ?? 'text'),
      ])
    );
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isConnected = useNatsStore((s) => s.isConnected);

  // ── load configs for create mode ──────────────────────────────────────────
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    setConfigsLoading(true);
    listDeviceTypeConfigs({ includeInactive: false }).then((list) => {
      if (cancelled) return;
      setConfigs(list);
      if (list.length > 0 && !formData.deviceTypeConfigId) {
        const first = list[0];
        setFormData((prev) => ({
          ...prev,
          deviceTypeConfigId: first.id,
          revisionIntervalMonths: first.defaultRevisionIntervalMonths,
        }));
        setSelectedConfig(first);
        setFields(first.fields ?? []);
      }
    }).catch(() => {
      // non-fatal: fall back gracefully
    }).finally(() => {
      if (!cancelled) setConfigsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode]);

  // ── load fields for edit mode ──────────────────────────────────────────────
  const loadedConfigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isEditMode) return;
    const cfgId = device?.deviceTypeConfigId;
    if (!cfgId || loadedConfigRef.current === cfgId) return;
    loadedConfigRef.current = cfgId;
    getDeviceTypeConfig(cfgId).then((cfg) => {
      setSelectedConfig(cfg);
      setFields((cfg.fields ?? []).filter((f) => f.isActive || device?.customFields?.some((v) => v.fieldId === f.id)));
    }).catch(() => {});
  }, [isEditMode, device]);

  // ── handle config change in create mode ───────────────────────────────────
  const handleConfigChange = useCallback((configId: string) => {
    const cfg = configs.find((c) => c.id === configId) ?? null;
    setFormData((prev) => ({
      ...prev,
      deviceTypeConfigId: configId,
      revisionIntervalMonths: cfg?.defaultRevisionIntervalMonths ?? prev.revisionIntervalMonths,
    }));
    setSelectedConfig(cfg);
    setFields(cfg?.fields ?? []);
    setFieldValues({}); // reset custom values on type change
  }, [configs]);

  const handleChange = useCallback((field: keyof FormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleFieldValueChange = useCallback((fieldId: string, displayValue: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: displayValue }));
  }, []);

  // ── submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected) {
      setError(t('errors.not_connected'));
      return;
    }

    if (!formData.deviceTypeConfigId) {
      setError(t('device_form_select_type'));
      return;
    }

    // Validate required custom fields
    for (const f of fields.filter((f) => f.isRequired && f.isActive)) {
      const val = fieldValues[f.id] ?? '';
      if (val.trim() === '' || val === 'false') {
        setError(t('device_form_required_field', { label: f.label }));
        return;
      }
    }

    // Build custom fields payload
    const customFields = fields
      .filter((f) => f.isActive && fieldValues[f.id] != null && fieldValues[f.id] !== '')
      .map((f) => ({
        fieldId: f.id,
        valueJson: encodeValueJson(fieldValues[f.id], f.fieldType) ?? '',
      }))
      .filter((cfv) => cfv.valueJson !== '' && cfv.valueJson !== null);

    try {
      setIsSubmitting(true);
      setError(null);

      if (isEditMode && device) {
        const updateData: UpdateDeviceRequest = {
          id: device.id,
          manufacturer: formData.manufacturer.trim() !== (device.manufacturer ?? '')
            ? formData.manufacturer.trim() || undefined
            : undefined,
          model: formData.model.trim() !== (device.model ?? '')
            ? formData.model.trim() || undefined
            : undefined,
          serialNumber: formData.serialNumber.trim() !== (device.serialNumber ?? '')
            ? formData.serialNumber.trim() || undefined
            : undefined,
          installationDate: formData.installationDate !== (device.installationDate ?? '')
            ? formData.installationDate || undefined
            : undefined,
          revisionIntervalMonths: formData.revisionIntervalMonths !== device.revisionIntervalMonths
            ? formData.revisionIntervalMonths
            : undefined,
          notes: formData.notes.trim() !== (device.notes ?? '')
            ? formData.notes.trim() || undefined
            : undefined,
          customFields: customFields.length > 0 ? customFields : undefined,
        };
        await updateDevice(customerId, updateData);
      } else {
        const createData: CreateDeviceRequest = {
          customerId,
          deviceType: selectedConfig?.deviceTypeKey ?? 'other',
          deviceTypeConfigId: formData.deviceTypeConfigId,
          manufacturer: formData.manufacturer.trim() || undefined,
          model: formData.model.trim() || undefined,
          serialNumber: formData.serialNumber.trim() || undefined,
          installationDate: formData.installationDate || undefined,
          revisionIntervalMonths: formData.revisionIntervalMonths,
          notes: formData.notes.trim() || undefined,
          customFields: customFields.length > 0 ? customFields : undefined,
        };
        await createDevice(createData);
      }

      onSuccess();
    } catch (err) {
      console.error('Failed to save device:', err);
      setError(err instanceof Error ? err.message : t('device_error_save'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, isEditMode, device, customerId, onSuccess, fields, fieldValues, selectedConfig, t]);

  const activeFields = fields.filter((f) => f.isActive);
  const isArchivedType = isEditMode && selectedConfig != null && !selectedConfig.isActive;

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h3 className={styles.title}>
        {isEditMode ? t('device_edit') : t('device_new')}
      </h3>

      {error && <div className={styles.error}>{error}</div>}

      {isArchivedType && (
        <div className={styles.archivedWarning}>
          {t('device_archived_type_warning')}
        </div>
      )}

      {/* Device type selector (create mode) or label (edit mode) */}
      <div className={styles.field}>
        <label className={styles.label}>
          {t('device_form_type')} <span className={styles.required}>*</span>
        </label>
        {isEditMode ? (
          <div className={styles.typeDisplay}>
            {selectedConfig ? selectedConfig.label : (
              device?.deviceType
                ? t(DEVICE_TYPE_KEYS[device.deviceType as keyof typeof DEVICE_TYPE_KEYS] ?? device.deviceType)
                : '—'
            )}
          </div>
        ) : configsLoading ? (
          <div className={styles.typeDisplay}>{t('loading')}</div>
        ) : configs.length > 0 ? (
          <select
            value={formData.deviceTypeConfigId}
            onChange={(e) => handleConfigChange(e.target.value)}
            className={styles.select}
            disabled={isSubmitting}
          >
            <option value="">—</option>
            {configs.map((cfg) => (
              <option key={cfg.id} value={cfg.id}>
                {cfg.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={formData.deviceTypeConfigId}
            onChange={(e) => handleChange('deviceTypeConfigId', e.target.value)}
            className={styles.select}
            disabled={isSubmitting}
          >
            {Object.entries(DEVICE_TYPE_KEYS).map(([type, key]) => (
              <option key={type} value={type}>
                {t(key)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="manufacturer" className={styles.label}>{t('device_form_manufacturer')}</label>
          <input
            type="text"
            id="manufacturer"
            value={formData.manufacturer}
            onChange={(e) => handleChange('manufacturer', e.target.value)}
            className={styles.input}
            placeholder="Junkers, Vaillant..."
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="model" className={styles.label}>{t('device_form_model')}</label>
          <input
            type="text"
            id="model"
            value={formData.model}
            onChange={(e) => handleChange('model', e.target.value)}
            className={styles.input}
            placeholder="Cerapur, ecoTEC..."
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="serialNumber" className={styles.label}>{t('device_form_serial_number')}</label>
        <input
          type="text"
          id="serialNumber"
          value={formData.serialNumber}
          onChange={(e) => handleChange('serialNumber', e.target.value)}
          className={styles.input}
          placeholder="SN12345678"
          disabled={isSubmitting}
        />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="installationDate" className={styles.label}>{t('device_form_installation_date')}</label>
          <input
            type="date"
            id="installationDate"
            value={formData.installationDate}
            onChange={(e) => handleChange('installationDate', e.target.value)}
            className={styles.input}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="revisionIntervalMonths" className={styles.label}>
            {t('device_form_revision_interval')}
          </label>
          <input
            type="number"
            id="revisionIntervalMonths"
            value={formData.revisionIntervalMonths}
            onChange={(e) => handleChange('revisionIntervalMonths', parseInt(e.target.value) || 12)}
            className={styles.input}
            min={1}
            max={120}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="notes" className={styles.label}>{t('device_form_notes')}</label>
        <textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          className={styles.textarea}
          placeholder={t('device_form_notes_placeholder')}
          rows={3}
          disabled={isSubmitting}
        />
      </div>

      {/* Custom fields */}
      {activeFields.length > 0 && (
        <div className={styles.customFieldsSection}>
          <p className={styles.customFieldsTitle}>{t('device_form_custom_fields')}</p>
          {activeFields.map((f) => (
            <DynamicFieldRenderer
              key={f.id}
              field={f}
              value={fieldValues[f.id] ?? ''}
              onChange={(val) => handleFieldValueChange(f.id, val)}
              disabled={isSubmitting}
            />
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
          disabled={isSubmitting}
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting || !isConnected || (!isEditMode && !formData.deviceTypeConfigId)}
        >
          {isSubmitting ? t('saving') : (isEditMode ? t('device_form_save_changes') : t('device_add'))}
        </button>
      </div>
    </form>
  );
}
