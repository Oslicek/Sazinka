import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '../../stores/natsStore';
import { createRequest } from '@shared/messages';
import { getToken } from '@/utils/auth';
import styles from './CountriesManager.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Country {
  code: string;
  alpha3: string;
  nameEn: string;
  nameCs: string;
  nameSk: string;
  hasMapCoverage: boolean;
  valhallaRegion: string | null;
  nominatimPriority: number;
  isSupported: boolean;
  sortOrder: number;
}

interface SyncResult {
  synced: number;
  added: number;
  updated: number;
}

type ApiEnvelope<T> = { payload?: T };

const unwrap = <T,>(r: ApiEnvelope<T> | T): T => {
  if (typeof r === 'object' && r !== null && 'payload' in r) return ((r as ApiEnvelope<T>).payload ?? r) as T;
  return r as T;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CountriesManager() {
  const { t, i18n } = useTranslation('pages');
  const { request } = useNatsStore();

  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);

  const loadCountries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await request<unknown, ApiEnvelope<{ items: Country[] }>>(
        'sazinka.admin.countries.list',
        createRequest(getToken(), {})
      );
      const data = unwrap(resp);
      setCountries(data.items ?? []);
      setLoaded(true);
    } catch (e) {
      setError(t('countries_error_load'));
    } finally {
      setLoading(false);
    }
  }, [request, t]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const resp = await request<unknown, ApiEnvelope<SyncResult>>(
        'sazinka.admin.countries.sync',
        createRequest(getToken(), {})
      );
      const result = unwrap(resp);
      setSyncResult(result);
      await loadCountries();
    } catch (e) {
      setError(t('countries_error_sync'));
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateCountry = async (code: string, patch: Partial<Pick<Country, 'hasMapCoverage' | 'isSupported' | 'valhallaRegion' | 'nominatimPriority' | 'sortOrder'>>) => {
    try {
      const resp = await request<unknown, ApiEnvelope<Country>>(
        'sazinka.admin.countries.update',
        createRequest(getToken(), { code, ...patch })
      );
      const updated = unwrap(resp);
      setCountries(prev => prev.map(c => c.code === code ? updated : c));
    } catch (e) {
      setError(t('countries_error_update'));
    }
  };

  const localeName = (c: Country) => {
    const lang = i18n.language.split('-')[0];
    if (lang === 'cs') return c.nameCs;
    if (lang === 'sk') return c.nameSk;
    return c.nameEn;
  };

  const filtered = countries.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return localeName(c).toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
  });

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2>{t('countries_title')}</h2>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.syncBtn}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? t('countries_syncing') : t('countries_sync_btn')}
          </button>
          {!loaded && (
            <button type="button" className={styles.loadBtn} onClick={loadCountries} disabled={loading}>
              {loading ? t('countries_loading') : t('countries_load_btn')}
            </button>
          )}
        </div>
      </div>

      {syncResult && (
        <div className={styles.syncResult}>
          {t('countries_sync_result', { synced: syncResult.synced, added: syncResult.added, updated: syncResult.updated })}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {loaded && (
        <>
          <input
            type="search"
            className={styles.search}
            placeholder={t('countries_search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('countries_col_flag')}</th>
                  <th>{t('countries_col_code')}</th>
                  <th>{t('countries_col_name')}</th>
                  <th>{t('countries_col_alpha3')}</th>
                  <th>{t('countries_col_map')}</th>
                  <th>{t('countries_col_supported')}</th>
                  <th>{t('countries_col_valhalla')}</th>
                  <th>{t('countries_col_sort')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.code}>
                    <td className={styles.flagCell}>{getFlagEmoji(c.code)}</td>
                    <td className={styles.codeCell}>{c.code}</td>
                    <td>{localeName(c)}</td>
                    <td className={styles.alpha3Cell}>{c.alpha3}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={c.hasMapCoverage}
                        onChange={(e) => handleUpdateCountry(c.code, { hasMapCoverage: e.target.checked })}
                        title={t('countries_col_map')}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={c.isSupported}
                        onChange={(e) => handleUpdateCountry(c.code, { isSupported: e.target.checked })}
                        title={t('countries_col_supported')}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className={styles.regionInput}
                        defaultValue={c.valhallaRegion ?? ''}
                        placeholder="e.g. europe"
                        onBlur={(e) => {
                          const val = e.target.value.trim() || null;
                          if (val !== c.valhallaRegion) handleUpdateCountry(c.code, { valhallaRegion: val });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={styles.sortInput}
                        defaultValue={c.sortOrder}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value) || 999;
                          if (val !== c.sortOrder) handleUpdateCountry(c.code, { sortOrder: val });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className={styles.empty}>{t('countries_empty')}</div>
          )}
        </>
      )}

      {!loaded && !loading && (
        <div className={styles.hint}>{t('countries_load_hint')}</div>
      )}
    </section>
  );
}

/** Convert ISO 3166-1 alpha-2 code to flag emoji (works on macOS/Linux; shows code on Windows). */
function getFlagEmoji(code: string): string {
  const offset = 127397;
  return [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
}
