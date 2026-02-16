import { useState, useRef, useCallback, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import styles from './TimeInput.module.css';

interface TimeInputProps {
  /** Current value in HH:MM or HH:MM:SS format (24h) */
  value: string;
  /** Called with the new HH:MM value on change */
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
}

/**
 * Locale-independent time input that always displays 24-hour format.
 * Replaces native <input type="time"> which follows the OS locale and may
 * show AM/PM on English-locale systems even when the app is set to Czech.
 */
export function TimeInput({ value, onChange, id, disabled, min, max }: TimeInputProps) {
  const displayValue = value.slice(0, 5);
  const [draft, setDraft] = useState(displayValue);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValidTime = useCallback((v: string): boolean => {
    if (!/^\d{2}:\d{2}$/.test(v)) return false;
    const [h, m] = v.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    if (min && v < min.slice(0, 5)) return false;
    if (max && v > max.slice(0, 5)) return false;
    return true;
  }, [min, max]);

  const commit = useCallback((raw: string) => {
    const clean = raw.replace(/[^\d:]/g, '');
    if (isValidTime(clean)) {
      onChange(clean);
    }
    setEditing(false);
  }, [isValidTime, onChange]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/[^\d:]/g, '');

    // Auto-insert colon after two digits
    if (v.length === 2 && !v.includes(':') && draft.length < v.length) {
      v = v + ':';
    }

    // Limit to HH:MM length
    if (v.length > 5) v = v.slice(0, 5);

    setDraft(v);
  };

  const handleFocus = () => {
    setDraft(displayValue);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const handleBlur = (_e: FocusEvent<HTMLInputElement>) => {
    commit(draft);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(draft);
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setDraft(displayValue);
      setEditing(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className={styles.timeInput}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        id={id}
        value={editing ? draft : displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="HH:MM"
        maxLength={5}
        autoComplete="off"
      />
      <span className={styles.clockIcon} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 4.5V8L10.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}
