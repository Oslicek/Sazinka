import { useEffect, useMemo, useRef, useState } from 'react';
import * as workerService from '@/services/workerService';
import { useActiveJobsStore } from '@/stores/activeJobsStore';
import {
  downloadExportJob,
  submitExportJob,
  subscribeExportJob,
  type ExportPlusFile,
  type ExportScope,
} from '@/services/exportPlusService';
import styles from './ExportPlusPanel.module.css';

type Option = { id: string; label: string };

interface ExportPlusPanelProps {
  adminMode?: boolean;
  crewOptions?: Option[];
  depotOptions?: Option[];
}

const FILE_OPTIONS: Array<{ id: ExportPlusFile; label: string; help: string }> = [
  { id: 'customers', label: 'customers.csv', help: 'zákazníci' },
  { id: 'devices', label: 'devices.csv', help: 'zařízení' },
  { id: 'revisions', label: 'revisions.csv', help: 'revize' },
  { id: 'communications', label: 'communications.csv', help: 'komunikace' },
  { id: 'work_log', label: 'work_log.csv', help: 'pracovní deník' },
  { id: 'routes', label: 'routes.csv + route_stops.csv', help: 'trasy' },
];

const REVISION_STATUS = ['upcoming', 'scheduled', 'confirmed', 'completed', 'cancelled'];
const VISIT_STATUS = ['planned', 'in_progress', 'completed', 'cancelled', 'rescheduled'];
const ROUTE_STATUS = ['draft', 'planned', 'optimized', 'completed', 'cancelled'];

function toggleString(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function toggleFile(list: ExportPlusFile[], item: ExportPlusFile): ExportPlusFile[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function ExportPlusPanel({ adminMode = false, crewOptions = [], depotOptions = [] }: ExportPlusPanelProps) {
  const addJob = useActiveJobsStore((s) => s.addJob);
  const [selectedFiles, setSelectedFiles] = useState<ExportPlusFile[]>(['customers', 'devices', 'revisions', 'communications', 'work_log', 'routes']);
  const [scope, setScope] = useState<ExportScope>('customer_only');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revisionStatuses, setRevisionStatuses] = useState<string[]>([]);
  const [visitStatuses, setVisitStatuses] = useState<string[]>([]);
  const [routeStatuses, setRouteStatuses] = useState<string[]>([]);
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [depotIds, setDepotIds] = useState<string[]>([]);
  const [workers, setWorkers] = useState<Array<{ id: string; name: string }>>([]);
  const [workerSearch, setWorkerSearch] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const filteredWorkers = useMemo(() => {
    if (!workerSearch.trim()) return workers;
    const q = workerSearch.trim().toLowerCase();
    return workers.filter((w) => w.name.toLowerCase().includes(q));
  }, [workers, workerSearch]);

  const loadWorkersIfNeeded = async (nextScope: ExportScope) => {
    if (nextScope === 'customer_only') return;
    if (workers.length > 0) return;
    const list = await workerService.listWorkers().catch(() => []);
    setWorkers(list.map((w) => ({ id: w.id, name: w.name })));
  };

  const handleExport = async () => {
    setError(null);
    setInfo(null);
    if (selectedFiles.length === 0) {
      setError('Vyberte alespoň jeden soubor pro export.');
      return;
    }
    if (scope === 'single_worker' && !selectedWorkerId) {
      setError('Vyberte pracovníka pro režim 1C.');
      return;
    }
    setSubmitting(true);
    try {
      const submit = await submitExportJob({
        scope,
        selectedFiles,
        selectedWorkerId: scope === 'single_worker' ? selectedWorkerId : undefined,
        userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userTimeZoneOffsetMinutes: new Date().getTimezoneOffset(),
        filters: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          revisionStatuses,
          visitStatuses,
          routeStatuses,
          crewIds,
          depotIds,
        },
      });

      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }

      addJob({
        id: submit.jobId,
        type: 'export',
        name: 'Export dat',
        status: 'queued',
        progressText: `Pozice ve frontě: ${submit.position}`,
        startedAt: new Date(),
      });

      const shortId = submit.jobId.slice(0, 8);
      setInfo(`Export ${shortId} byl spuštěn a běží na pozadí. Jeho stav a soubor ke stažení najdete v Úlohách.`);
      unsubscribeRef.current = await subscribeExportJob(submit.jobId, async (update) => {
        if (update.status.type === 'processing') {
          setInfo(update.status.message || 'Export běží na pozadí...');
        }
        if (update.status.type === 'failed') {
          setError(update.status.error || 'Export selhal.');
          setSubmitting(false);
        }
        if (update.status.type === 'completed') {
          setSubmitting(false);
          setInfo('Export dokončen. Připravuji stažení ZIP...');
          try {
            const { filename, blob } = await downloadExportJob(update.jobId);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            if ('Notification' in window) {
              if (Notification.permission === 'default') {
                await Notification.requestPermission();
              }
              if (Notification.permission === 'granted') {
                new Notification('Export připraven', {
                  body: `Soubor ${filename} je připraven ke stažení.`,
                });
              }
            }
            setInfo(`Export hotov: ${filename}`);
          } catch (downloadError) {
            setError(downloadError instanceof Error ? downloadError.message : 'Stažení exportu selhalo.');
          }
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export selhal.');
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.panel}>
      <p className={styles.intro}>
        Export+ vytvoří ZIP s CSV kompatibilními s importem. Filtry se kombinují logikou AND.
      </p>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h4>Soubory k exportu</h4>
          <div className={styles.chipWrap}>
            {FILE_OPTIONS.map((f) => {
              const active = selectedFiles.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  onClick={() => setSelectedFiles((prev) => toggleFile(prev, f.id))}
                  title={f.help}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </section>

        {adminMode && (
          <section className={styles.card}>
            <h4>Rozsah exportu</h4>
            <div className={styles.field}>
              <label>Režim</label>
              <select
                value={scope}
                onChange={async (e) => {
                  const next = e.target.value as ExportScope;
                  setScope(next);
                  await loadWorkersIfNeeded(next);
                }}
              >
                <option value="customer_only">Settings: jen moje firma</option>
                <option value="all_workers_combined">Admin 1A: všichni v kombinovaných souborech</option>
                <option value="all_workers_split">Admin 1B: všichni po pracovnících</option>
                <option value="single_worker">Admin 1C: jeden pracovník</option>
              </select>
            </div>

            {scope === 'single_worker' && (
              <>
                <div className={styles.field}>
                  <label>Hledat pracovníka</label>
                  <input
                    type="text"
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="např. Novák"
                  />
                </div>
                <div className={styles.field}>
                  <label>Vybraný pracovník</label>
                  <select value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)}>
                    <option value="">— vyberte —</option>
                    {filteredWorkers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </section>
        )}

        <section className={styles.card}>
          <h4>Datum (AND)</h4>
          <div className={styles.field}>
            <label>Od</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Do</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </section>

        <section className={styles.card}>
          <h4>Stavy revizí (AND)</h4>
          <div className={styles.chipWrap}>
            {REVISION_STATUS.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.chip} ${revisionStatuses.includes(s) ? styles.chipActive : ''}`}
                onClick={() => setRevisionStatuses((prev) => toggleString(prev, s))}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h4>Stavy návštěv (AND)</h4>
          <div className={styles.chipWrap}>
            {VISIT_STATUS.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.chip} ${visitStatuses.includes(s) ? styles.chipActive : ''}`}
                onClick={() => setVisitStatuses((prev) => toggleString(prev, s))}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h4>Stavy tras (AND)</h4>
          <div className={styles.chipWrap}>
            {ROUTE_STATUS.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.chip} ${routeStatuses.includes(s) ? styles.chipActive : ''}`}
                onClick={() => setRouteStatuses((prev) => toggleString(prev, s))}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h4>Posádky a depa (AND)</h4>
          <div className={styles.field}>
            <label>Posádky</label>
            <div className={styles.chipWrap}>
              {crewOptions.length === 0 && <span className={styles.intro}>Není dostupné</span>}
              {crewOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.chip} ${crewIds.includes(c.id) ? styles.chipActive : ''}`}
                  onClick={() => setCrewIds((prev) => toggleString(prev, c.id))}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label>Depa</label>
            <div className={styles.chipWrap}>
              {depotOptions.length === 0 && <span className={styles.intro}>Není dostupné</span>}
              {depotOptions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`${styles.chip} ${depotIds.includes(d.id) ? styles.chipActive : ''}`}
                  onClick={() => setDepotIds((prev) => toggleString(prev, d.id))}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <button className={styles.btn} type="button" onClick={handleExport} disabled={submitting}>
          {submitting ? 'Spouštím export...' : 'Spustit async export'}
        </button>
        {error && <span className={styles.error}>{error}</span>}
        {!error && info && <span className={styles.infoNotice}>{info}</span>}
      </div>
    </div>
  );
}
