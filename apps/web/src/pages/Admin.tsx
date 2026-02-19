import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import { createRequest } from '@shared/messages';
import { getToken } from '@/utils/auth';
import { importCustomersBatch, submitGeocodeAllPending } from '../services/customerService';
import { ImportModal, type ImportEntityType } from '../components/import';
import { ImportCustomersModal } from '../components/customers/ImportCustomersModal';
import { ExportPlusPanel } from '../components/shared/ExportPlusPanel';
import { CountriesManager } from '../components/admin/CountriesManager';
import { useActiveJobsStore, type ActiveJob } from '../stores/activeJobsStore';
import { logger } from '../utils/logger';
import { formatTime, formatNumber } from '../i18n/formatters';
import styles from './Admin.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminTab = 'services' | 'database' | 'countries' | 'export' | 'import' | 'logs';

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'error' | 'unknown';
  details?: string;
  lastCheck?: string;
}

interface DatabaseInfo {
  size_bytes: number;
  size_human: string;
  tables: { name: string; rows: number; size: string }[];
  connection_status: 'connected' | 'disconnected' | 'error';
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  target?: string;
}

type ApiEnvelope<T> = { payload?: T };

interface PingResponse { timestamp?: number }
interface AdminDbStatus {
  connected: boolean;
  sizeHuman?: string; size_human?: string;
  sizeBytes?: number; size_bytes?: number;
  tables?: { name: string; rows: number; size: string }[];
}
interface AdminServiceAvailability { available: boolean; url?: string; version?: string }
interface AdminJetStreamStatus {
  available: boolean;
  streams?: { messages?: number }[];
  consumers?: { pending?: number }[];
}
interface AdminGeocodeStatus {
  available: boolean;
  pendingCustomers?: number; failedCustomers?: number; streamMessages?: number;
}
interface AdminLogsResponse { logs?: LogEntry[] }

const unwrapPayload = <T,>(response: ApiEnvelope<T> | T): T => {
  if (typeof response === 'object' && response !== null && 'payload' in response) {
    const payload = (response as ApiEnvelope<T>).payload;
    return (payload ?? response) as T;
  }
  return response as T;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function Admin() {
  const { t } = useTranslation('pages');
  const { t: tJobs } = useTranslation('jobs');
  const { request, isConnected: connected } = useNatsStore();

  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#/, '') as AdminTab;
      const valid: AdminTab[] = ['services', 'database', 'countries', 'export', 'import', 'logs'];
      if (valid.includes(hash)) return hash;
    }
    return 'services';
  });

  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'NATS', status: 'unknown' },
    { name: 'PostgreSQL', status: 'unknown' },
    { name: 'Valhalla', status: 'unknown' },
    { name: 'Nominatim', status: 'unknown' },
    { name: 'JetStream', status: 'unknown' },
    { name: 'Geocoding', status: 'unknown' },
    { name: 'Worker', status: 'unknown' },
    { name: 'Frontend', status: 'running' },
  ]);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importEntityType, setImportEntityType] = useState<ImportEntityType>('device');
  const [showCustomerImport, setShowCustomerImport] = useState(false);
  const [isSubmittingGeocode, setIsSubmittingGeocode] = useState(false);
  const [isRestartingStack, setIsRestartingStack] = useState(false);

  const allJobs = useActiveJobsStore((s) => s.jobs);
  const { runningImportJobs, runningExportJobs } = useMemo(() => {
    const imports: ActiveJob[] = [];
    const exports: ActiveJob[] = [];
    for (const job of allJobs.values()) {
      if (job.status !== 'queued' && job.status !== 'processing') continue;
      if (job.type.startsWith('import')) imports.push(job);
      else if (job.type === 'export') exports.push(job);
    }
    return { runningImportJobs: imports, runningExportJobs: exports };
  }, [allJobs]);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') window.location.hash = tab;
  };

  const handleOpenImport = (entityType: ImportEntityType) => {
    setImportEntityType(entityType);
    setImportModalOpen(true);
  };

  const handleCustomerImportBatch = useCallback(
    async (customers: Parameters<typeof importCustomersBatch>[0]) => importCustomersBatch(customers),
    []
  );

  const handleTriggerGeocode = useCallback(async () => {
    setIsSubmittingGeocode(true);
    try {
      const result = await submitGeocodeAllPending();
      if (result) alert(t('admin_geocode_success', { jobId: result.jobId }));
      else alert(t('admin_geocode_none'));
      runHealthCheck();
    } catch (error) {
      alert(t('admin_geocode_error', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsSubmittingGeocode(false);
    }
  }, []);

  const handleRestartStack = useCallback(async () => {
    if (!confirm(t('admin_restart_stack_confirm'))) return;
    setIsRestartingStack(true);
    try {
      await request<unknown, { payload?: { success: boolean; message: string } }>(
        'sazinka.admin.restart.all',
        createRequest(getToken(), {})
      );
      alert(t('admin_restart_stack_initiated'));
    } catch (error) {
      alert(t('admin_restart_stack_error', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsRestartingStack(false);
    }
  }, [request, t]);

  const runHealthCheck = useCallback(async () => {
    setIsChecking(true);
    const newServices = [...services];

    const natsIdx = newServices.findIndex(s => s.name === 'NATS');
    if (natsIdx >= 0) {
      newServices[natsIdx] = { ...newServices[natsIdx], status: connected ? 'running' : 'error', lastCheck: new Date().toISOString(), details: connected ? 'WebSocket connected' : 'WebSocket disconnected' };
    }

    try {
      const startTime = Date.now();
      await request<{ timestamp: number }, PingResponse>('sazinka.ping', { timestamp: startTime });
      const responseTime = Date.now() - startTime;
      const workerIdx = newServices.findIndex(s => s.name === 'Worker');
      if (workerIdx >= 0) newServices[workerIdx] = { ...newServices[workerIdx], status: 'running', lastCheck: new Date().toISOString(), details: `Responded in ${responseTime}ms` };
    } catch (e) {
      const workerIdx = newServices.findIndex(s => s.name === 'Worker');
      if (workerIdx >= 0) newServices[workerIdx] = { ...newServices[workerIdx], status: 'error', lastCheck: new Date().toISOString(), details: String(e) };
    }

    try {
      const response = await request<unknown, ApiEnvelope<AdminDbStatus> | AdminDbStatus>('sazinka.admin.db.status', createRequest(getToken(), {}));
      const dbResult = unwrapPayload(response);
      const pgIdx = newServices.findIndex(s => s.name === 'PostgreSQL');
      if (pgIdx >= 0) newServices[pgIdx] = { ...newServices[pgIdx], status: dbResult.connected ? 'running' : 'error', lastCheck: new Date().toISOString(), details: dbResult.connected ? `${dbResult.sizeHuman || dbResult.size_human}` : 'Connection failed' };
      setDbInfo({ size_bytes: dbResult.sizeBytes || dbResult.size_bytes || 0, size_human: dbResult.sizeHuman || dbResult.size_human || 'N/A', tables: dbResult.tables || [], connection_status: dbResult.connected ? 'connected' : 'disconnected' });
    } catch (e) {
      const pgIdx = newServices.findIndex(s => s.name === 'PostgreSQL');
      if (pgIdx >= 0) newServices[pgIdx] = { ...newServices[pgIdx], status: 'error', lastCheck: new Date().toISOString(), details: String(e) };
    }

    try {
      const response = await request<unknown, ApiEnvelope<AdminServiceAvailability> | AdminServiceAvailability>('sazinka.admin.valhalla.status', createRequest(getToken(), {}));
      const r = unwrapPayload(response);
      const idx = newServices.findIndex(s => s.name === 'Valhalla');
      if (idx >= 0) newServices[idx] = { ...newServices[idx], status: r.available ? 'running' : 'stopped', lastCheck: new Date().toISOString(), details: r.available ? r.url : 'Not available' };
    } catch { const idx = newServices.findIndex(s => s.name === 'Valhalla'); if (idx >= 0) newServices[idx] = { ...newServices[idx], status: 'unknown', lastCheck: new Date().toISOString(), details: 'Could not check' }; }

    try {
      const response = await request<unknown, ApiEnvelope<AdminServiceAvailability> | AdminServiceAvailability>('sazinka.admin.nominatim.status', createRequest(getToken(), {}));
      const r = unwrapPayload(response);
      const idx = newServices.findIndex(s => s.name === 'Nominatim');
      if (idx >= 0) {
        const isConfigured = r.url && r.url !== 'Not configured';
        newServices[idx] = { ...newServices[idx], status: r.available ? 'running' : (isConfigured ? 'starting' : 'stopped'), lastCheck: new Date().toISOString(), details: r.available ? `${r.url}${r.version ? ` v${r.version}` : ''}` : (isConfigured ? 'Importing data / starting up...' : 'Not configured') };
      }
    } catch { const idx = newServices.findIndex(s => s.name === 'Nominatim'); if (idx >= 0) newServices[idx] = { ...newServices[idx], status: 'unknown', lastCheck: new Date().toISOString(), details: 'Could not check' }; }

    try {
      const response = await request<unknown, ApiEnvelope<AdminJetStreamStatus> | AdminJetStreamStatus>('sazinka.admin.jetstream.status', createRequest(getToken(), {}));
      const r = unwrapPayload(response);
      const idx = newServices.findIndex(s => s.name === 'JetStream');
      if (idx >= 0) {
        const streamInfo = r.streams?.[0];
        const consumerInfo = r.consumers?.[0];
        const details = streamInfo ? `${streamInfo.messages} msgs, ${consumerInfo?.pending || 0} pending` : (r.available ? 'Enabled' : 'Disabled');
        newServices[idx] = { ...newServices[idx], status: r.available ? 'running' : 'stopped', lastCheck: new Date().toISOString(), details };
      }
    } catch { const idx = newServices.findIndex(s => s.name === 'JetStream'); if (idx >= 0) newServices[idx] = { ...newServices[idx], status: 'unknown', lastCheck: new Date().toISOString(), details: 'Could not check' }; }

    try {
      const response = await request<unknown, ApiEnvelope<AdminGeocodeStatus> | AdminGeocodeStatus>('sazinka.admin.geocode.status', createRequest(getToken(), {}));
      const r = unwrapPayload(response);
      const idx = newServices.findIndex(s => s.name === 'Geocoding');
      if (idx >= 0) {
        const pending = r.pendingCustomers || 0;
        const failed = r.failedCustomers || 0;
        const queued = r.streamMessages || 0;
        let details = `${pending} pending`;
        if (failed > 0) details += `, ${failed} ${t('admin_failed_count')}`;
        details += `, ${queued} jobs queued`;
        newServices[idx] = { ...newServices[idx], status: r.available ? 'running' : 'stopped', lastCheck: new Date().toISOString(), details };
      }
    } catch { const idx = newServices.findIndex(s => s.name === 'Geocoding'); if (idx >= 0) newServices[idx] = { ...newServices[idx], status: 'unknown', lastCheck: new Date().toISOString(), details: 'Could not check' }; }

    setServices(newServices);
    setIsChecking(false);
  }, [connected, request, services]);

  const loadLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const response = await request<unknown, ApiEnvelope<AdminLogsResponse> | AdminLogsResponse>('sazinka.admin.logs', createRequest(getToken(), { limit: 100, level: logFilter }));
      const result = unwrapPayload(response);
      setLogs(result.logs || []);
    } catch (e) {
      logger.error('Failed to load logs:', e);
    }
    setIsLoadingLogs(false);
  }, [request, logFilter]);

  const resetDatabase = async () => {
    if (!confirm(t('admin_db_confirm_reset'))) return;
    setIsResettingDb(true);
    try {
      await request('sazinka.admin.db.reset', createRequest(getToken(), {}));
      alert(t('admin_db_reset_success'));
      runHealthCheck();
    } catch (e) {
      alert(t('admin_db_reset_error') + ' ' + String(e));
    }
    setIsResettingDb(false);
  };

  useEffect(() => {
    if (connected) { runHealthCheck(); loadLogs(); }
  }, [connected]);

  useEffect(() => {
    if (autoRefresh && connected) {
      const interval = setInterval(() => { runHealthCheck(); loadLogs(); }, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, connected, runHealthCheck, loadLogs]);

  // Hash sync on mount
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '') as AdminTab;
      const valid: AdminTab[] = ['services', 'database', 'countries', 'export', 'import', 'logs'];
      if (valid.includes(hash)) setActiveTab(hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const getStatusColor = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'running': return styles.statusRunning;
      case 'starting': return styles.statusStarting;
      case 'stopped': return styles.statusStopped;
      case 'error': return styles.statusError;
      default: return styles.statusUnknown;
    }
  };

  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'running': return '●';
      case 'starting': return '◐';
      case 'stopped': return '○';
      case 'error': return '✕';
      default: return '?';
    }
  };

  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'services',  label: t('admin_tab_services') },
    { id: 'database',  label: t('admin_tab_database') },
    { id: 'countries', label: t('admin_tab_countries') },
    { id: 'export',    label: t('admin_tab_export') },
    { id: 'import',    label: t('admin_tab_import') },
    { id: 'logs',      label: t('admin_tab_logs') },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>{t('admin_title')}</h1>
        <div className={styles.headerActions}>
          <label className={styles.autoRefresh}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            {t('admin_auto_refresh')}
          </label>
        </div>
      </div>

      <div className={styles.adminLayout}>
        {/* Sidebar */}
        <nav className={styles.sidebar}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.sidebarItem} ${activeTab === tab.id ? styles.sidebarItemActive : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className={styles.contentArea}>

          {/* ── Services ── */}
          {activeTab === 'services' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>{t('admin_services_title')}</h2>
                <div className={styles.serviceActions}>
                  <button type="button" className={styles.dangerButton} onClick={handleRestartStack} disabled={isRestartingStack || !connected}>
                    {isRestartingStack ? t('admin_restart_stack_busy') : t('admin_restart_stack')}
                  </button>
                  <button type="button" className={styles.primaryButton} onClick={runHealthCheck} disabled={isChecking || !connected}>
                    {isChecking ? t('admin_checking') : t('admin_health_check')}
                  </button>
                </div>
              </div>
              <div className={styles.servicesGrid}>
                {services.map((service) => (
                  <div key={service.name} className={styles.serviceCard}>
                    <div className={styles.serviceHeader}>
                      <span className={`${styles.statusIndicator} ${getStatusColor(service.status)}`}>{getStatusIcon(service.status)}</span>
                      <span className={styles.serviceName}>{service.name}</span>
                    </div>
                    <div className={styles.serviceDetails}>
                      <span className={styles.serviceStatus}>{service.status}</span>
                      {service.details && <span className={styles.serviceInfo}>{service.details}</span>}
                      {service.lastCheck && <span className={styles.lastCheck}>{t('admin_last_check')} {formatTime(service.lastCheck)}</span>}
                    </div>
                    <div className={styles.serviceActions}>
                      {service.name === 'Geocoding' ? (
                        <button className={styles.smallButton} onClick={handleTriggerGeocode} disabled={isSubmittingGeocode || !connected} title={t('admin_geocode_trigger')}>
                          {isSubmittingGeocode ? t('admin_geocode_submitting') : t('admin_geocode_run')}
                        </button>
                      ) : (
                        <button className={styles.smallButton} disabled={service.name === 'Frontend'} title={t('admin_restart_title')}>
                          {t('admin_restart')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Database ── */}
          {activeTab === 'database' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>{t('admin_db_title')}</h2>
              </div>
              {dbInfo ? (
                <div className={styles.dbInfo}>
                  <div className={styles.dbStats}>
                    <div className={styles.dbStat}>
                      <span className={styles.dbStatLabel}>{t('admin_db_size')}</span>
                      <span className={styles.dbStatValue}>{dbInfo.size_human}</span>
                    </div>
                    <div className={styles.dbStat}>
                      <span className={styles.dbStatLabel}>{t('admin_db_status')}</span>
                      <span className={`${styles.dbStatValue} ${dbInfo.connection_status === 'connected' ? styles.textGreen : styles.textRed}`}>
                        {dbInfo.connection_status === 'connected' ? t('admin_db_connected') : t('admin_db_disconnected')}
                      </span>
                    </div>
                  </div>
                  {dbInfo.tables && dbInfo.tables.length > 0 && (
                    <div className={styles.tablesContainer}>
                      <h3>{t('admin_db_tables')}</h3>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>{t('admin_db_col_name')}</th>
                            <th>{t('admin_db_col_rows')}</th>
                            <th>{t('admin_db_col_size')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dbInfo.tables.map((table) => (
                            <tr key={table.name}>
                              <td>{table.name}</td>
                              <td>{formatNumber(table.rows)}</td>
                              <td>{table.size}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className={styles.dbActions}>
                    <button type="button" className={styles.dangerButton} onClick={resetDatabase} disabled={isResettingDb}>
                      {isResettingDb ? t('admin_db_resetting') : t('admin_db_reset')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.noData}>{t('admin_db_loading')}</div>
              )}
            </section>
          )}

          {/* ── Countries ── */}
          {activeTab === 'countries' && (
            <CountriesManager />
          )}

          {/* ── Export ── */}
          {activeTab === 'export' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>{t('admin_export_title')}</h2>
              </div>
              {runningExportJobs.length > 0 && (
                <div className={styles.runningJobNotice}>
                  {runningExportJobs.map(job => (
                    <div key={job.id} className={styles.runningJobRow}>
                      <span className={styles.runningJobPulse} />
                      <span>{tJobs('running_job_notice', { name: job.name })}</span>
                      {job.progressText && <span className={styles.runningJobProgress}>{job.progressText}</span>}
                      <Link to="/jobs" className={styles.runningJobLink}>{tJobs('go_to_jobs')} &rarr;</Link>
                    </div>
                  ))}
                </div>
              )}
              <ExportPlusPanel adminMode />
            </section>
          )}

          {/* ── Import ── */}
          {activeTab === 'import' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>{t('admin_import_title')}</h2>
              </div>
              {runningImportJobs.length > 0 && (
                <div className={styles.runningJobNotice}>
                  {runningImportJobs.map(job => (
                    <div key={job.id} className={styles.runningJobRow}>
                      <span className={styles.runningJobPulse} />
                      <span>{tJobs('running_job_notice', { name: job.name })}</span>
                      {job.progressText && <span className={styles.runningJobProgress}>{job.progressText}</span>}
                      <Link to="/jobs" className={styles.runningJobLink}>{tJobs('go_to_jobs')} &rarr;</Link>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.exportContainer}>
                {[
                  { key: 'customers', handler: () => setShowCustomerImport(true) },
                  { key: 'devices',   handler: () => handleOpenImport('device') },
                  { key: 'revisions', handler: () => handleOpenImport('revision') },
                  { key: 'comm',      handler: () => handleOpenImport('communication') },
                  { key: 'worklog',   handler: () => handleOpenImport('work_log') },
                  { key: 'zip',       handler: () => handleOpenImport('zip') },
                ].map(({ key, handler }) => (
                  <div key={key} className={styles.exportCard}>
                    <h3>{t(`admin_import_${key}_title`)}</h3>
                    <p className={styles.exportDescription}>{t(`admin_import_${key}_desc`)}</p>
                    <button type="button" className={styles.primaryButton} onClick={handler} disabled={!connected}>
                      {t(`admin_import_${key}_btn`)}
                    </button>
                  </div>
                ))}
              </div>
              <div className={styles.importHint}>
                <p>📋 <a href="/PROJECT_IMPORT.MD" target="_blank" rel="noopener noreferrer">{t('admin_import_docs')}</a></p>
                <p>{t('admin_import_order_hint')}</p>
              </div>
            </section>
          )}

          {/* ── Logs ── */}
          {activeTab === 'logs' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>{t('admin_logs_title')}</h2>
                <div className={styles.logControls}>
                  <select value={logFilter} onChange={(e) => setLogFilter(e.target.value)} className={styles.select}>
                    <option value="all">{t('admin_logs_all')}</option>
                    <option value="error">{t('admin_logs_error')}</option>
                    <option value="warn">{t('admin_logs_warn')}</option>
                    <option value="info">{t('admin_logs_info')}</option>
                    <option value="debug">{t('admin_logs_debug')}</option>
                  </select>
                  <button type="button" className={styles.secondaryButton} onClick={loadLogs} disabled={isLoadingLogs}>
                    {isLoadingLogs ? t('admin_logs_loading') : t('admin_logs_refresh')}
                  </button>
                </div>
              </div>
              <div className={styles.logsContainer}>
                {logs.length > 0 ? (
                  <div className={styles.logsList}>
                    {logs.map((log, index) => (
                      <div key={index} className={`${styles.logEntry} ${styles[`log${log.level.charAt(0).toUpperCase() + log.level.slice(1)}`]}`}>
                        <span className={styles.logTime}>{formatTime(log.timestamp)}</span>
                        <span className={styles.logLevel}>{log.level.toUpperCase()}</span>
                        {log.target && <span className={styles.logTarget}>{log.target}</span>}
                        <span className={styles.logMessage}>{log.message}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.noData}>{isLoadingLogs ? t('admin_logs_loading_text') : t('admin_logs_empty')}</div>
                )}
              </div>
            </section>
          )}

        </div>
      </div>

      {/* Modals */}
      <ImportModal isOpen={importModalOpen} onClose={() => setImportModalOpen(false)} entityType={importEntityType} onComplete={() => runHealthCheck()} />
      <ImportCustomersModal isOpen={showCustomerImport} onClose={() => setShowCustomerImport(false)} />

      {!connected && <div className={styles.connectionBanner}>{t('admin_not_connected')}</div>}
    </div>
  );
}

export default Admin;
