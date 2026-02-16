import { useState, useRef, useCallback, useEffect, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
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
  /** Interval in minutes between dropdown options (default 15) */
  step?: number;
}

function generateTimeOptions(step: number, min?: string, max?: string): string[] {
  const options: string[] = [];
  const minMinutes = min ? parseTimeToMinutes(min) : 0;
  const maxMinutes = max ? parseTimeToMinutes(max) : 24 * 60 - 1;

  for (let m = 0; m < 24 * 60; m += step) {
    if (m >= minMinutes && m <= maxMinutes) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      options.push(`${hh}:${mm}`);
    }
  }
  return options;
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Locale-independent time input that always displays 24-hour format.
 * Features a dropdown picker (click the clock icon) and manual text entry.
 */
export function TimeInput({ value, onChange, id, disabled, min, max, step = 15 }: TimeInputProps) {
  const displayValue = value.slice(0, 5);
  const [draft, setDraft] = useState(displayValue);
  const [editing, setEditing] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options = generateTimeOptions(step, min, max);

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

    if (v.length === 2 && !v.includes(':') && draft.length < v.length) {
      v = v + ':';
    }

    if (v.length > 5) v = v.slice(0, 5);

    setDraft(v);
  };

  const handleFocus = () => {
    setDraft(displayValue);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const handleBlur = (_e: FocusEvent<HTMLInputElement>) => {
    // Delay commit so dropdown click can fire first
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        commit(draft);
        setDropdownOpen(false);
      }
    }, 150);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(draft);
      setDropdownOpen(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setDraft(displayValue);
      setEditing(false);
      setDropdownOpen(false);
      inputRef.current?.blur();
    }
    if (e.key === 'ArrowDown' && !dropdownOpen) {
      e.preventDefault();
      setDropdownOpen(true);
    }
  };

  const handleToggleDropdown = () => {
    if (disabled) return;
    setDropdownOpen(prev => !prev);
    if (!dropdownOpen) {
      inputRef.current?.focus();
    }
  };

  const handleSelectOption = (time: string) => {
    onChange(time);
    setDraft(time);
    setEditing(false);
    setDropdownOpen(false);
  };

  // Scroll to the selected/closest option when dropdown opens
  useEffect(() => {
    if (dropdownOpen && listRef.current) {
      const currentMinutes = parseTimeToMinutes(displayValue);
      let closestIdx = 0;
      let closestDiff = Infinity;
      options.forEach((opt, i) => {
        const diff = Math.abs(parseTimeToMinutes(opt) - currentMinutes);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      });
      const items = listRef.current.children;
      if (items[closestIdx]) {
        (items[closestIdx] as HTMLElement).scrollIntoView({ block: 'center' });
      }
    }
  }, [dropdownOpen, displayValue, options]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [dropdownOpen]);

  return (
    <div className={styles.timeInput} ref={containerRef}>
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
      <button
        type="button"
        className={styles.clockButton}
        onClick={handleToggleDropdown}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Vybrat čas"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 4.5V8L10.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {dropdownOpen && (
        <ul className={styles.dropdown} ref={listRef} role="listbox">
          {options.map(time => (
            <li
              key={time}
              role="option"
              aria-selected={time === displayValue}
              className={`${styles.dropdownItem} ${time === displayValue ? styles.dropdownItemSelected : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectOption(time);
              }}
            >
              {time}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
