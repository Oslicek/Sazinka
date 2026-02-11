/**
 * WorkLog page - Work records overview
 *
 * Shows all visit records filterable by date range, crew, and depot.
 * Reuses the shared PlannerFilters component.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearch, useNavigate, Link } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import * as settingsService from '../services/settingsService';
import * as visitService from '../services/visitService';
import { listCrews, type Crew } from '../services/crewService';
import type { Depot } from '@shared/settings';
import type { Visit, VisitResult } from '@shared/visit';
import { PlannerFilters } from '../components/shared/PlannerFilters';
import { QuickVisitDialog } from '../components/worklog';
import styles from './WorkLog.module.css';

interface WorkLogSearchParams {
  dateFrom?: string;
  dateTo?: string;
  crew?: string;
  depot?: string;
}

export function WorkLog() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as WorkLogSearchParams;
  const { isConnected } = useNatsStore();

  // --- Filters ---
  const today = new Date().toISOString().split('T')[0];
  // Default to last 30 days range
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(searchParams?.dateFrom || thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(searchParams?.dateTo || today);
  const [isDateRange, setIsDateRange] = useState(true);
  const [filterCrewId, setFilterCrewId] = useState<string>(searchParams?.crew || '');
  const [filterDepotId, setFilterDepotId] = useState<string>(searchParams?.depot || '');

  // --- Data ---
  const [crews, setCrews] = useState<Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);

  // --- Loading ---
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isQuickVisitDialogOpen, setIsQuickVisitDialogOpen] = useState(false);
  const [visitToComplete, setVisitToComplete] = useState<Visit | null>(null);
  const [completeResult, setCompleteResult] = useState<VisitResult>('successful');
  const [completeNotes, setCompleteNotes] = useState('');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [followUpReason, setFollowUpReason] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);

  // ─── Load settings ──────────────────────────────────────────────

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

        // Apply user preferences as default filter values (only if no URL params)
        const prefs = settings.preferences;
        if (!searchParams?.crew && prefs?.defaultCrewId) {
          setFilterCrewId(prefs.defaultCrewId);
        }
        if (!searchParams?.depot && prefs?.defaultDepotId) {
          setFilterDepotId(prefs.defaultDepotId);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
        setError('Nepodařilo se načíst nastavení');
      } finally {
        setIsLoadingSettings(false);
      }
    }
    loadSettings();
  // Intentionally keyed by connection only; URL search params are applied as initial defaults.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // ─── Load visits ────────────────────────────────────────────────

  const refreshVisits = useCallback(async () => {
    if (!isConnected || isLoadingSettings) return;
    try {
      setIsLoadingVisits(true);
      setError(null);

      const response = await visitService.listVisits({
        dateFrom,
        dateTo: isDateRange ? dateTo : dateFrom,
        limit: 500,
      });

      setVisits(response.visits);
    } catch (err) {
      console.error('Failed to load visits:', err);
      setError('Nepodařilo se načíst záznamy práce');
    } finally {
      setIsLoadingVisits(false);
    }
  }, [isConnected, isLoadingSettings, dateFrom, dateTo, isDateRange]);

  useEffect(() => {
    void refreshVisits();
  }, [refreshVisits]);

  // ─── Filter visits by crew and depot (client-side) ──────────────

  const filteredVisits = useMemo(() => {
    let result = visits;

    if (filterCrewId) {
      result = result.filter((v) => v.crewId === filterCrewId);
    }

    if (filterDepotId) {
      // Filter by depot: find crews that belong to the selected depot
      const depotCrewIds = crews
        .filter((c) => c.homeDepotId === filterDepotId)
        .map((c) => c.id);
      result = result.filter((v) => v.crewId && depotCrewIds.includes(v.crewId));
    }

    // Sort by date descending, then by time
    return result.sort((a, b) => {
      const dateCompare = b.scheduledDate.localeCompare(a.scheduledDate);
      if (dateCompare !== 0) return dateCompare;
      const timeA = a.scheduledTimeStart || '00:00';
      const timeB = b.scheduledTimeStart || '00:00';
      return timeA.localeCompare(timeB);
    });
  }, [visits, filterCrewId, filterDepotId, crews]);

  // ─── URL sync ──────────────────────────────────────────────────

  const syncUrl = useCallback((params: Partial<WorkLogSearchParams>) => {
    navigate({
      to: '/worklog',
      search: {
        dateFrom: params.dateFrom ?? dateFrom,
        dateTo: params.dateTo ?? dateTo,
        crew: params.crew ?? (filterCrewId || undefined),
        depot: params.depot ?? (filterDepotId || undefined),
      } as Record<string, string | undefined>,
      replace: true,
    });
  }, [dateFrom, dateTo, filterCrewId, filterDepotId, navigate]);

  const handleDateFromChange = useCallback((value: string) => {
    setDateFrom(value);
    if (!isDateRange) setDateTo(value);
    syncUrl({ dateFrom: value, dateTo: isDateRange ? dateTo : value });
  }, [isDateRange, dateTo, syncUrl]);

  const handleDateToChange = useCallback((value: string) => {
    setDateTo(value);
    syncUrl({ dateTo: value });
  }, [syncUrl]);

  const handleToggleRange = useCallback(() => {
    setIsDateRange((prev) => {
      if (prev) {
        setDateTo(dateFrom);
      }
      return !prev;
    });
  }, [dateFrom]);

  const handleCrewFilterChange = useCallback((value: string) => {
    setFilterCrewId(value);
    syncUrl({ crew: value || undefined });
  }, [syncUrl]);

  const handleDepotFilterChange = useCallback((value: string) => {
    setFilterDepotId(value);
    syncUrl({ depot: value || undefined });
  }, [syncUrl]);

  // ─── Helpers ────────────────────────────────────────────────────

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('cs-CZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (time?: string | null) => {
    if (!time) return '–';
    return time.substring(0, 5);
  };

  const getCrewName = (crewId?: string | null) => {
    if (!crewId) return '–';
    return crews.find((c) => c.id === crewId)?.name || '–';
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed': return styles.badgeCompleted;
      case 'planned': return styles.badgePlanned;
      case 'in_progress': return styles.badgeInProgress;
      case 'cancelled': return styles.badgeCancelled;
      case 'rescheduled': return styles.badgeRescheduled;
      default: return '';
    }
  };

  const canQuickComplete = (visit: Visit) => visit.status === 'planned' || visit.status === 'in_progress';

  const openCompleteDialog = (visit: Visit) => {
    setVisitToComplete(visit);
    setCompleteResult('successful');
    setCompleteNotes('');
    setRequiresFollowUp(false);
    setFollowUpReason('');
  };

  const closeCompleteDialog = () => {
    if (isCompleting) return;
    setVisitToComplete(null);
  };

  const handleCompleteVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitToComplete) return;
    try {
      setIsCompleting(true);
      await visitService.completeVisit({
        id: visitToComplete.id,
        result: completeResult,
        resultNotes: completeNotes.trim() || undefined,
        requiresFollowUp,
        followUpReason: requiresFollowUp ? followUpReason.trim() || undefined : undefined,
      });
      setVisitToComplete(null);
      await refreshVisits();
    } catch (err) {
      console.error('Failed to complete visit:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit návštěvu');
    } finally {
      setIsCompleting(false);
    }
  };

  // ─── Group visits by date ───────────────────────────────────────

  const groupedVisits = useMemo(() => {
    const groups: { date: string; visits: Visit[] }[] = [];
    let currentDate = '';
    let currentGroup: Visit[] = [];

    for (const visit of filteredVisits) {
      if (visit.scheduledDate !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, visits: currentGroup });
        }
        currentDate = visit.scheduledDate;
        currentGroup = [visit];
      } else {
        currentGroup.push(visit);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, visits: currentGroup });
    }

    return groups;
  }, [filteredVisits]);

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.title}>Záznam práce</h1>
          <span className={styles.count}>
            {filteredVisits.length} {filteredVisits.length === 1 ? 'záznam' : filteredVisits.length >= 2 && filteredVisits.length <= 4 ? 'záznamy' : 'záznamů'}
          </span>
        </div>
        <button
          type="button"
          className={styles.quickCreateBtn}
          onClick={() => setIsQuickVisitDialogOpen(true)}
        >
          + Rychlý záznam
        </button>
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
          <button type="button" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {isLoadingVisits || isLoadingSettings ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Načítám záznamy...</span>
        </div>
      ) : filteredVisits.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📋</span>
          <p>Žádné záznamy práce pro zvolené období</p>
          <p className={styles.emptyHint}>Zkuste změnit filtry nebo rozšířit datový rozsah.</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          {groupedVisits.map((group) => (
            <div key={group.date} className={styles.dateGroup}>
              <div className={styles.dateGroupHeader}>
                <Link
                  to="/calendar"
                  className={styles.dateGroupLabel}
                >
                  {formatDate(group.date)}
                </Link>
                <span className={styles.dateGroupCount}>{group.visits.length}</span>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thTime}>Čas</th>
                    <th className={styles.thCustomer}>Zákazník</th>
                    <th className={styles.thAddress}>Adresa</th>
                    <th className={styles.thType}>Typ</th>
                    <th className={styles.thCrew}>Posádka</th>
                    <th className={styles.thStatus}>Stav</th>
                    <th className={styles.thResult}>Výsledek</th>
                    <th className={styles.thActions}>Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {group.visits.map((visit) => (
                    <tr key={visit.id} className={styles.row}>
                      <td className={styles.tdTime}>
                        <Link
                          to="/visits/$visitId"
                          params={{ visitId: visit.id }}
                          className={styles.cellLink}
                        >
                          {formatTime(visit.scheduledTimeStart)}
                          {visit.scheduledTimeEnd ? ` – ${formatTime(visit.scheduledTimeEnd)}` : ''}
                        </Link>
                      </td>
                      <td className={styles.tdCustomer}>
                        <Link
                          to="/customers/$customerId"
                          params={{ customerId: visit.customerId }}
                          className={styles.cellLink}
                        >
                          {visit.customerName || '–'}
                        </Link>
                      </td>
                      <td className={styles.tdAddress}>
                        <Link
                          to="/customers/$customerId"
                          params={{ customerId: visit.customerId }}
                          className={styles.cellLink}
                        >
                          {[visit.customerStreet, visit.customerCity].filter(Boolean).join(', ') || '–'}
                        </Link>
                      </td>
                      <td className={styles.tdType}>
                        <Link
                          to="/visits/$visitId"
                          params={{ visitId: visit.id }}
                          className={styles.cellLink}
                        >
                          {visitService.getVisitTypeLabel(visit.visitType)}
                        </Link>
                      </td>
                      <td className={styles.tdCrew}>
                        <Link
                          to="/visits/$visitId"
                          params={{ visitId: visit.id }}
                          className={styles.cellLink}
                        >
                          {getCrewName(visit.crewId)}
                        </Link>
                      </td>
                      <td className={styles.tdStatus}>
                        <Link
                          to="/visits/$visitId"
                          params={{ visitId: visit.id }}
                          className={styles.cellLink}
                        >
                          <span className={`${styles.badge} ${getStatusBadgeClass(visit.status)}`}>
                            {visitService.getVisitStatusIcon(visit.status)} {visitService.getVisitStatusLabel(visit.status)}
                          </span>
                        </Link>
                      </td>
                      <td className={styles.tdResult}>
                        <Link
                          to="/visits/$visitId"
                          params={{ visitId: visit.id}}
                          className={styles.cellLink}
                        >
                          {visit.result ? visitService.getVisitResultLabel(visit.result) : '–'}
                        </Link>
                      </td>
                      <td className={styles.tdActions}>
                        {canQuickComplete(visit) ? (
                          <button
                            type="button"
                            className={styles.completeBtn}
                            onClick={() => openCompleteDialog(visit)}
                          >
                            Dokončit
                          </button>
                        ) : (
                          <span className={styles.actionPlaceholder}>–</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <QuickVisitDialog
        open={isQuickVisitDialogOpen}
        onClose={() => setIsQuickVisitDialogOpen(false)}
        onCreated={() => {
          setIsQuickVisitDialogOpen(false);
          void refreshVisits();
        }}
      />

      {visitToComplete && (
        <div className={styles.overlay} onClick={closeCompleteDialog}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Dokončit návštěvu</h3>
            <p className={styles.dialogSubtitle}>
              {visitToComplete.customerName || 'Zákazník'} ({formatDate(visitToComplete.scheduledDate)})
            </p>
            <form className={styles.dialogForm} onSubmit={handleCompleteVisit}>
              <label className={styles.dialogField}>
                <span>Výsledek</span>
                <select
                  value={completeResult}
                  onChange={(e) => setCompleteResult(e.target.value as VisitResult)}
                  disabled={isCompleting}
                >
                  <option value="successful">{visitService.getVisitResultLabel('successful')}</option>
                  <option value="partial">{visitService.getVisitResultLabel('partial')}</option>
                  <option value="failed">{visitService.getVisitResultLabel('failed')}</option>
                  <option value="customer_absent">{visitService.getVisitResultLabel('customer_absent')}</option>
                  <option value="rescheduled">{visitService.getVisitResultLabel('rescheduled')}</option>
                </select>
              </label>

              <label className={styles.dialogField}>
                <span>Poznámka</span>
                <textarea
                  rows={3}
                  value={completeNotes}
                  onChange={(e) => setCompleteNotes(e.target.value)}
                  placeholder="Krátké shrnutí provedené práce"
                  disabled={isCompleting}
                />
              </label>

              <label className={styles.dialogCheck}>
                <input
                  type="checkbox"
                  checked={requiresFollowUp}
                  onChange={(e) => setRequiresFollowUp(e.target.checked)}
                  disabled={isCompleting}
                />
                <span>Vyžaduje navazující krok</span>
              </label>

              {requiresFollowUp && (
                <label className={styles.dialogField}>
                  <span>Důvod navazujícího kroku</span>
                  <input
                    type="text"
                    value={followUpReason}
                    onChange={(e) => setFollowUpReason(e.target.value)}
                    placeholder="Např. čekáme na materiál"
                    disabled={isCompleting}
                  />
                </label>
              )}

              <div className={styles.dialogActions}>
                <button type="button" className={styles.dialogCancelBtn} onClick={closeCompleteDialog} disabled={isCompleting}>
                  Zrušit
                </button>
                <button type="submit" className={styles.dialogSubmitBtn} disabled={isCompleting}>
                  {isCompleting ? 'Ukládám...' : 'Potvrdit dokončení'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
