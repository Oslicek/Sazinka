import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { countries as allCountriesData, searchCountries } from '@sazinka/countries';
import styles from './CountrySelect.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CountryOption {
  code: string;
  alpha3: string;
  name: Record<string, string>;
}

export interface CountrySelectProps {
  value: string | null;
  onChange: (code: string | null) => void;
  /** Show a clear (×) button when a value is selected. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFlagEmoji(code: string): string {
  const offset = 127397;
  return [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CountrySelect({ value, onChange, clearable, disabled, className }: CountrySelectProps) {
  const { t, i18n } = useTranslation('pages');
  const locale = i18n.language.split('-')[0];

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Lazy: countries are only loaded into state when the dropdown is first opened
  const [loaded, setLoaded] = useState(false);
  const [filtered, setFiltered] = useState<CountryOption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load countries on first open
  const loadCountries = useCallback(() => {
    if (loaded) return;
    setFiltered(allCountriesData as CountryOption[]);
    setLoaded(true);
  }, [loaded]);

  // Filter on search change
  useEffect(() => {
    if (!loaded) return;
    setFiltered(searchCountries(search, locale, allCountriesData as CountryOption[]) as CountryOption[]);
  }, [search, locale, loaded]);

  // Open dropdown
  const handleOpen = () => {
    if (disabled) return;
    loadCountries();
    setOpen(true);
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  // Resolve display name for current value
  const selectedCountry = value ? (allCountriesData as CountryOption[]).find(c => c.code === value) : null;
  const displayName = selectedCountry
    ? (selectedCountry.name[locale] ?? selectedCountry.name['en'] ?? value)
    : null;

  return (
    <div ref={containerRef} className={`${styles.container} ${className ?? ''}`}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={handleOpen}
        disabled={disabled}
      >
        <span className={styles.triggerContent}>
          {value ? (
            <>
              <span className={styles.flag}>{getFlagEmoji(value)}</span>
              <span className={styles.name}>{displayName ?? value}</span>
              <span className={styles.code}>{value}</span>
            </>
          ) : (
            <span className={styles.placeholder}>{t('country_select_placeholder')}</span>
          )}
        </span>
        <span className={styles.triggerActions}>
          {clearable && value && (
            <span
              role="button"
              className={styles.clearBtn}
              title={t('country_select_clear')}
              onClick={handleClear}
              onKeyDown={(e) => e.key === 'Enter' && handleClear(e as unknown as React.MouseEvent)}
              tabIndex={0}
            >
              ×
            </span>
          )}
          <span className={styles.chevron}>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.searchWrapper}>
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder={t('country_select_search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ul className={styles.list} role="listbox">
            {filtered.length === 0 ? (
              <li className={styles.empty}>{t('country_select_empty')}</li>
            ) : (
              filtered.map((c) => (
                <li
                  key={c.code}
                  role="option"
                  aria-selected={c.code === value}
                  className={`${styles.option} ${c.code === value ? styles.optionSelected : ''}`}
                  onClick={() => handleSelect(c.code)}
                >
                  <span className={styles.flag}>{getFlagEmoji(c.code)}</span>
                  <span className={styles.name}>{c.name[locale] ?? c.name['en'] ?? c.code}</span>
                  <span className={styles.optionCode}>{c.code}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
