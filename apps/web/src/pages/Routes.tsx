/**
 * Routes page - Overview of all planned routes in table format
 *
 * Shows all routes with their parameters, allows deletion and crew assignment.
 * Reuses the shared PlannerFilters component.
 */

import { useEffect, useState, useCallback } from 'react';
import { useSearch, useNavigate, Link } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import * as settingsService from '../services/settingsService';
import * as routeService from '../services/routeService';
import { listCrews, type Crew } from '../services/crewService';
import type { Depot } from '@shared/settings';
import type { SavedRoute } from '../services/routeService';
import { PlannerFilters } from '../components/shared/PlannerFilters';
import styles from './Routes.module.css';

interface RoutesSearchParams {
  dateFrom?: string;
  dateTo?: string;
  crew?: string;
  depot?: string;
}

export function Routes() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as RoutesSearchParams;
  const { isConnected } = useNatsStore();

  // --- Filters ---
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(searchParams?.dateFrom || weekAgo);
  const [dateTo, setDateTo] = useState(searchParams?.dateTo || weekAhead);
  const [isDateRange, setIsDateRange] = useState(true);
  const [filterCrewId, setFilterCrewId] = useState<string>(searchParams?.crew || '');
  const [filterDepotId, setFilterDepotId] = useState<string>(searchParams?.depot || '');

  // --- Data ---
  const [crews, setCrews] = useState<Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);

  // --- Loading ---
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null);

  // ─── Load settings ────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected) return;

    async function loadSettings() {
      try {
        setIsLoadingSettings(true);
        const [settings, crewList] = await Promise.all([
          settingsService.getSettings(),
          listCrews(true),
        ]);
        setCrews(crewList);
        setDepots(settings.depots);

        const prefs = settings.preferences;
        if (!searchParams?.crew && prefs?.defaultCrewId) {
          setFilterCrewId(prefs.defaultCrewId);
        }
        if (!searchParams?.depot && prefs?.defaultDepotId) {
          setFilterDepotId(prefs.defaultDepotId);
        }
      } catch (err) {
        console.warn('Failed to load settings:', err);
      } finally {
        setIsLoadingSettings(false);
      }
    }
    loadSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // ─── Load routes ──────────────────────────────────────────────

  const loadRoutes = useCallback(async () => {
    if (!isConnected) return;

    setIsLoadingRoutes(true);
    setError(null);
    try {
      const effectiveDateTo = isDateRange ? dateTo : dateFrom;
      const response = await routeService.listRoutes({
        dateFrom,
        dateTo: effectiveDateTo,
        crewId: filterCrewId || null,
        depotId: filterDepotId || null,
      });
      setRoutes(response.routes);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Failed to load routes:', detail);
      setError(`Nepodařilo se načíst trasy: ${detail}`);
      setRoutes([]);
    } finally {
      setIsLoadingRoutes(false);
    }
  }, [isConnected, dateFrom, dateTo, isDateRange, filterCrewId, filterDepotId]);

  useEffect(() => {
    if (!isLoadingSettings) {
      loadRoutes();
    }
  }, [loadRoutes, isLoadingSettings]);

  // ─── URL sync ─────────────────────────────────────────────────

  const handleDateFromChange = useCallback((value: string) => {
    setDateFrom(value);
    if (!isDateRange) setDateTo(value);
    navigate({
      to: '/routes',
      search: { dateFrom: value, dateTo, crew: filterCrewId || undefined, depot: filterDepotId || undefined } as Record<string, string | undefined>,
      replace: true,
    });
  }, [isDateRange, dateTo, filterCrewId, filterDepotId, navigate]);

  const handleDateToChange = useCallback((value: string) => {
    setDateTo(value);
  }, []);

  const handleToggleRange = useCallback(() => {
    setIsDateRange((prev) => {
      if (prev) setDateTo(dateFrom);
      return !prev;
    });
  }, [dateFrom]);

  const handleCrewFilterChange = useCallback((value: string) => {
    setFilterCrewId(value);
  }, []);

  const handleDepotFilterChange = useCallback((value: string) => {
    setFilterDepotId(value);
  }, []);

  // ─── Delete route ─────────────────────────────────────────────

  const handleDeleteRoute = useCallback(async (routeId: string) => {
    if (!window.confirm('Opravdu chcete smazat tuto trasu?')) return;

    setDeletingRouteId(routeId);
    try {
      await routeService.deleteRoute(routeId);
      setRoutes((prev) => prev.filter((r) => r.id !== routeId));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Nepodařilo se smazat trasu: ${detail}`);
    } finally {
      setDeletingRouteId(null);
    }
  }, []);

  // ─── Assign crew ──────────────────────────────────────────────

  const handleCrewAssign = useCallback(async (routeId: string, crewId: string) => {
    try {
      await routeService.updateRoute(routeId, { crewId: crewId || null });
      setRoutes((prev) =>
        prev.map((r) => {
          if (r.id !== routeId) return r;
          const crew = crews.find((c) => c.id === crewId);
          return { ...r, crewId: crewId || null, crewName: crew?.name };
        })
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Nepodařilo se přiřadit posádku: ${detail}`);
    }
  }, [crews]);

  // ─── Helpers ──────────────────────────────────────────────────

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const dayNames = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    return `${dayNames[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
  }

  function formatDuration(minutes: number | null): string {
    if (!minutes || minutes <= 0) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h${m.toString().padStart(2, '0')}`;
  }

  function formatDistance(km: number | null): string {
    if (!km || km <= 0) return '—';
    return `${Math.round(km)} km`;
  }

  function getDepotName(depotId: string | null): string {
    if (!depotId) return '—';
    const depot = depots.find((d) => d.id === depotId);
    return depot?.name ?? '—';
  }

  function getStatusBadge(status: string): { label: string; className: string } {
    switch (status) {
      case 'active':
        return { label: 'Aktivní', className: styles.badgeActive };
      case 'completed':
        return { label: 'Dokončeno', className: styles.badgeCompleted };
      case 'draft':
      default:
        return { label: 'Koncept', className: styles.badgeDraft };
    }
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Trasy</h1>
        <span className={styles.count}>
          {routes.length > 0 ? `${routes.length} tras` : ''}
        </span>
      </div>

      <PlannerFilters
        dateFrom={dateFrom}
        dateTo={dateTo}
        isDateRange={isDateRange}
        filterCrewId={filterCrewId}
        filterDepotId={filterDepotId}
        crews={crews}
        depots={depots}
        onDateFromChange={handleDateFromChange}
        onDateToChange={handleDateToChange}
        onToggleRange={handleToggleRange}
        onCrewChange={handleCrewFilterChange}
        onDepotChange={handleDepotFilterChange}
      />

      {error && (
        <div className={styles.error}>
          {error}
          <button type="button" onClick={() => setError(null)}>x</button>
        </div>
      )}

      {isLoadingRoutes ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Načítám trasy...</span>
        </div>
      ) : routes.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🗺️</div>
          <p>Žádné trasy pro vybrané období.</p>
          <p className={styles.emptyHint}>Zkuste změnit rozsah dat nebo filtry.</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thDate}>Datum</th>
                <th className={styles.thCrew}>Posádka</th>
                <th className={styles.thDepot}>Depo</th>
                <th className={styles.thStops}>Zastávky</th>
                <th className={styles.thDistance}>Vzdálenost</th>
                <th className={styles.thDuration}>Doba</th>
                <th className={styles.thStatus}>Stav</th>
                <th className={styles.thActions}>Akce</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => {
                const badge = getStatusBadge(route.status);
                const isDeleting = deletingRouteId === route.id;

                return (
                  <tr key={route.id} className={styles.row}>
                    <td className={styles.tdDate}>
                      <Link to="/planner" search={{ date: route.date }} className={styles.cellLink}>
                        {formatDate(route.date)}
                      </Link>
                    </td>
                    <td className={styles.tdCrew}>
                      <select
                        className={styles.crewSelect}
                        value={route.crewId || ''}
                        onChange={(e) => handleCrewAssign(route.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">— Nepřiřazena —</option>
                        {crews.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className={styles.tdDepot}>{getDepotName(route.depotId)}</td>
                    <td className={styles.tdStops}>{route.stopsCount ?? 0}</td>
                    <td className={styles.tdDistance}>{formatDistance(route.totalDistanceKm)}</td>
                    <td className={styles.tdDuration}>{formatDuration(route.totalDurationMinutes)}</td>
                    <td className={styles.tdStatus}>
                      <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td className={styles.tdActions}>
                      <Link
                        to="/planner"
                        search={{ date: route.date }}
                        className={styles.actionLink}
                        title="Zobrazit v plánu"
                      >
                        📋
                      </Link>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRoute(route.id);
                        }}
                        disabled={isDeleting}
                        title="Smazat trasu"
                      >
                        {isDeleting ? '...' : '🗑️'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
