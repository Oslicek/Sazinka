import type { DeviceTypeField, SelectOption } from '@shared/deviceTypeConfig';
import { useTranslation } from 'react-i18next';
import styles from './DynamicFieldRenderer.module.css';

// ── value helpers ─────────────────────────────────────────────────────────────

/** Decode valueJson → display string for an input element. */
export function decodeValueJson(valueJson: string | null | undefined, fieldType: string): string {
  if (valueJson == null || valueJson === '') return '';
  try {
    const parsed = JSON.parse(valueJson);
    if (fieldType === 'boolean') return parsed ? 'true' : 'false';
    return String(parsed);
  } catch {
    return String(valueJson);
  }
}

/** Encode display string → valueJson for storage. Returns null when empty/invalid. */
export function encodeValueJson(displayValue: string, fieldType: string): string | null {
  if (displayValue === '' || displayValue == null) return null;
  switch (fieldType) {
    case 'number': {
      const n = parseFloat(displayValue);
      return isNaN(n) ? null : JSON.stringify(n);
    }
    case 'boolean':
      return displayValue === 'true' ? 'true' : 'false';
    default:
      return JSON.stringify(displayValue);
  }
}

// ── component ─────────────────────────────────────────────────────────────────

interface DynamicFieldRendererProps {
  field: DeviceTypeField;
  /** Human-readable display value (decoded from valueJson) */
  value: string;
  onChange: (displayValue: string) => void;
  disabled?: boolean;
  /** When true, use compact inline layout */
  compact?: boolean;
}

export function DynamicFieldRenderer({
  field,
  value,
  onChange,
  disabled = false,
  compact = false,
}: DynamicFieldRendererProps) {
  const { t } = useTranslation('common');

  const renderInput = () => {
    switch (field.fieldType) {
      case 'text':
        return (
          <input
            type="text"
            className={styles.input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder ?? undefined}
            disabled={disabled}
            maxLength={500}
          />
        );

      case 'number':
        return (
          <div className={styles.numberWrapper}>
            <input
              type="number"
              className={styles.input}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder ?? undefined}
              disabled={disabled}
              step="any"
            />
            {field.unit && <span className={styles.unit}>{field.unit}</span>}
          </div>
        );

      case 'date':
        return (
          <input
            type="date"
            className={styles.input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        );

      case 'boolean':
        return (
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            disabled={disabled}
          />
        );

      case 'select': {
        const options: SelectOption[] = field.selectOptions ?? [];
        return (
          <select
            className={styles.select}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">— {t('device_field_select_empty')} —</option>
            {options.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
                {opt.isDeprecated ? ` (${t('device_field_deprecated')})` : ''}
              </option>
            ))}
          </select>
        );
      }

      default:
        return (
          <input
            type="text"
            className={styles.input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        );
    }
  };

  return (
    <div className={`${styles.field} ${compact ? styles.compact : ''}`}>
      <label className={styles.label}>
        {field.label}
        {field.isRequired && <span className={styles.required}> *</span>}
      </label>
      {renderInput()}
    </div>
  );
}

export default DynamicFieldRenderer;
