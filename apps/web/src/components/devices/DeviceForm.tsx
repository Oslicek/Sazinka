import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, CreateDeviceRequest, DeviceType } from '@shared/device';
import { DEVICE_TYPE_KEYS } from '@shared/device';
import { createDevice, updateDevice, type UpdateDeviceRequest } from '../../services/deviceService';
import { useNatsStore } from '../../stores/natsStore';
import styles from './DeviceForm.module.css';

interface DeviceFormProps {
  customerId: string;
  device?: Device;
  onSuccess: () => void;
  onCancel: () => void;
}

interface FormData {
  deviceType: DeviceType;
  manufacturer: string;
  model: string;
  serialNumber: string;
  installationDate: string;
  revisionIntervalMonths: number;
  notes: string;
}

const DEVICE_TYPES: DeviceType[] = [
  'gas_boiler',
  'gas_water_heater',
  'chimney',
  'fireplace',
  'gas_stove',
  'other',
];

const createInitialFormData = (device?: Device): FormData => ({
  deviceType: (device?.deviceType as DeviceType) ?? 'gas_boiler',
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isConnected = useNatsStore((s) => s.isConnected);

  const handleChange = useCallback((field: keyof FormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected) {
      setError('Není připojení k serveru');
      return;
    }

    // Validate required fields
    if (!formData.deviceType) {
      setError('Vyberte typ zařízení');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      if (isEditMode && device) {
        const updateData: UpdateDeviceRequest = {
          id: device.id,
          deviceType: formData.deviceType !== device.deviceType ? formData.deviceType : undefined,
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
        };
        
        await updateDevice(customerId, updateData);
      } else {
        const createData: CreateDeviceRequest = {
          customerId,
          deviceType: formData.deviceType,
          manufacturer: formData.manufacturer.trim() || undefined,
          model: formData.model.trim() || undefined,
          serialNumber: formData.serialNumber.trim() || undefined,
          installationDate: formData.installationDate || undefined,
          revisionIntervalMonths: formData.revisionIntervalMonths,
          notes: formData.notes.trim() || undefined,
        };
        
        await createDevice(createData);
      }

      onSuccess();
    } catch (err) {
      console.error('Failed to save device:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se uložit zařízení');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, formData, isEditMode, device, customerId, onSuccess]);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h3 className={styles.title}>
        {isEditMode ? 'Upravit zařízení' : 'Nové zařízení'}
      </h3>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.field}>
        <label htmlFor="deviceType" className={styles.label}>
          Typ zařízení <span className={styles.required}>*</span>
        </label>
        <select
          id="deviceType"
          value={formData.deviceType}
          onChange={(e) => handleChange('deviceType', e.target.value)}
          className={styles.select}
          disabled={isSubmitting}
        >
          {DEVICE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(DEVICE_TYPE_KEYS[type])}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="manufacturer" className={styles.label}>Výrobce</label>
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
          <label htmlFor="model" className={styles.label}>Model</label>
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
        <label htmlFor="serialNumber" className={styles.label}>Sériové číslo</label>
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
          <label htmlFor="installationDate" className={styles.label}>Datum instalace</label>
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
            Interval revizí (měsíce)
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
        <label htmlFor="notes" className={styles.label}>Poznámky</label>
        <textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          className={styles.textarea}
          placeholder="Další informace o zařízení..."
          rows={3}
          disabled={isSubmitting}
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
          disabled={isSubmitting}
        >
          Zrušit
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting || !isConnected}
        >
          {isSubmitting ? 'Ukládám...' : (isEditMode ? 'Uložit změny' : 'Přidat zařízení')}
        </button>
      </div>
    </form>
  );
}
