/**
 * WorkLog page - Work records overview
 *
 * Shows all visit records filterable by date range, crew, and depot.
 * Reuses the shared PlannerFilters component.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearch, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '../stores/natsStore';
import * as settingsService from '../services/settingsService';
import * as visitService from '../services/visitService';
import { listCrews, type Crew } from '../services/crewService';
import type { Depot } from '@shared/settings';
import type { Visit, VisitResult } from '@shared/visit';
import { PlannerFilters } from '../components/shared/PlannerFilters';
import { QuickVisitDialog } from '../components/worklog';
import { formatDate } from '../i18n/formatters';
import { ClipboardList, Calendar, RefreshCw, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import styles from './WorkLog.module.css';

interface WorkLogSearchParams {
  dateFrom?: string;
  dateTo?: string;
  crew?: string;
  depot?: string;
}

export function WorkLog() {
  const { t } = useTranslation('pages');
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
        setError(t('worklog_error_settings'));
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
      setError(t('worklog_error_load'));
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

  const getVisitStatusIcon = (status: string) => {
    switch (status) {
      case 'planned': return <Calendar size={13} />;
      case 'in_progress': return <RefreshCw size={13} />;
      case 'completed': return <CheckCircle2 size={13} />;
      case 'cancelled': return <XCircle size={13} />;
      case 'rescheduled': return <RotateCcw size={13} />;
      default: return null;
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
      setError(err instanceof Error ? err.message : t('worklog_error_complete'));
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
          <h1 className={styles.title}>{t('worklog_title')}</h1>
          <span className={styles.count}>
            {filteredVisits.length} {filteredVisits.length === 1 ? t('worklog_count_one') : filteredVisits.length >= 2 && filteredVisits.length <= 4 ? t('worklog_count_few') : t('worklog_count_other')}
          </span>
        </div>
        <button
          type="button"
          className={styles.quickCreateBtn}
          onClick={() => setIsQuickVisitDialogOpen(true)}
        >
          {t('worklog_quick_create')}
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
          <span>{t('worklog_loading')}</span>
        </div>
      ) : filteredVisits.length === 0 ? (
        <div className={styles.empty}>
          <ClipboardList size={16} className={styles.emptyIcon} />
          <p>{t('worklog_empty')}</p>
          <p className={styles.emptyHint}>{t('worklog_empty_hint')}</p>
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
                  {formatDate(group.date + 'T00:00:00', 'short')}
                </Link>
                <span className={styles.dateGroupCount}>{group.visits.length}</span>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thTime}>{t('worklog_col_time')}</th>
                    <th className={styles.thCustomer}>{t('worklog_col_customer')}</th>
                    <th className={styles.thAddress}>{t('worklog_col_address')}</th>
                    <th className={styles.thType}>{t('worklog_col_type')}</th>
                    <th className={styles.thCrew}>{t('worklog_col_crew')}</th>
                    <th className={styles.thStatus}>{t('worklog_col_status')}</th>
                    <th className={styles.thResult}>{t('worklog_col_result')}</th>
                    <th className={styles.thActions}>{t('worklog_col_actions')}</th>
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
                            {getVisitStatusIcon(visit.status)}{visitService.getVisitStatusLabel(visit.status)}
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
                            {t('worklog_complete')}
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
            <h3 className={styles.dialogTitle}>{t('worklog_complete_title')}</h3>
            <p className={styles.dialogSubtitle}>
              {visitToComplete.customerName || t('worklog_complete_customer')} ({visitToComplete.scheduledDate ? formatDate(visitToComplete.scheduledDate + 'T00:00:00', 'short') : '–'})
            </p>
            <form className={styles.dialogForm} onSubmit={handleCompleteVisit}>
              <label className={styles.dialogField}>
                <span>{t('worklog_complete_result')}</span>
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
                <span>{t('worklog_complete_notes')}</span>
                <textarea
                  rows={3}
                  value={completeNotes}
                  onChange={(e) => setCompleteNotes(e.target.value)}
                  placeholder={t('worklog_complete_notes_placeholder')}
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
                <span>{t('worklog_complete_follow_up')}</span>
              </label>

              {requiresFollowUp && (
                <label className={styles.dialogField}>
                  <span>{t('worklog_complete_follow_up_reason')}</span>
                  <input
                    type="text"
                    value={followUpReason}
                    onChange={(e) => setFollowUpReason(e.target.value)}
                    placeholder={t('worklog_complete_follow_up_placeholder')}
                    disabled={isCompleting}
                  />
                </label>
              )}

              <div className={styles.dialogActions}>
                <button type="button" className={styles.dialogCancelBtn} onClick={closeCompleteDialog} disabled={isCompleting}>
                  {t('common:cancel')}
                </button>
                <button type="submit" className={styles.dialogSubmitBtn} disabled={isCompleting}>
                  {isCompleting ? t('common:loading') : t('worklog_complete_confirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
