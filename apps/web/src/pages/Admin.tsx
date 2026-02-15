import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import i18n from '@/i18n';
import { useNatsStore } from '../stores/natsStore';
import { createRequest } from '@shared/messages';
import { getToken } from '@/utils/auth';
import { importCustomersBatch, submitGeocodeAllPending } from '../services/customerService';
import { ImportModal, type ImportEntityType } from '../components/import';
import { ImportCustomersModal } from '../components/customers/ImportCustomersModal';
import { ExportPlusPanel } from '../components/shared/ExportPlusPanel';
import { useActiveJobsStore, type ActiveJob } from '../stores/activeJobsStore';
import { logger } from '../utils/logger';
import { formatTime, formatNumber } from '../i18n/formatters';
import styles from './Admin.module.css';

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'error' | 'unknown';
  details?: string;
  lastCheck?: string;
}

interface HealthCheckResult {
  services: ServiceStatus[];
  timestamp: string;
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

interface PingResponse {
  timestamp?: number;
}

interface AdminDbStatus {
  connected: boolean;
  sizeHuman?: string;
  size_human?: string;
  sizeBytes?: number;
  size_bytes?: number;
  tables?: { name: string; rows: number; size: string }[];
}

interface AdminServiceAvailability {
  available: boolean;
  url?: string;
  version?: string;
}

interface AdminJetStreamStatus {
  available: boolean;
  streams?: { messages?: number }[];
  consumers?: { pending?: number }[];
}

interface AdminGeocodeStatus {
  available: boolean;
  pendingCustomers?: number;
  failedCustomers?: number;
  streamMessages?: number;
}

interface AdminLogsResponse {
  logs?: LogEntry[];
}

const unwrapPayload = <T,>(response: ApiEnvelope<T> | T): T => {
  if (typeof response === 'object' && response !== null && 'payload' in response) {
    const payload = (response as ApiEnvelope<T>).payload;
    return (payload ?? response) as T;
  }
  return response as T;
};

export function Admin() {
  const { t } = useTranslation('pages');
  const { request, isConnected: connected } = useNatsStore();
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'NATS', status: 'unknown' },
    { name: 'PostgreSQL', status: 'unknown' },
    { name: 'Valhalla', status: 'unknown' },
    { name: 'Nominatim', status: 'unknown' },
    { name: 'JetStream', status: 'unknown' },
    { name: 'Geocoding', status: 'unknown' },
    { name: 'Worker', status: 'unknown' },
    { name: 'Frontend', status: 'running' }, // Always running if we see this
  ]);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importEntityType, setImportEntityType] = useState<ImportEntityType>('device');
  const [showCustomerImport, setShowCustomerImport] = useState(false);

  // Running import/export jobs from global store
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
  
  const handleOpenImport = (entityType: ImportEntityType) => {
    setImportEntityType(entityType);
    setImportModalOpen(true);
  };
  
  const handleCloseImport = () => {
    setImportModalOpen(false);
  };
  
  const handleOpenCustomerImport = () => {
    setShowCustomerImport(true);
  };
  
  const handleCloseCustomerImport = () => {
    setShowCustomerImport(false);
  };

  // Handler for customer import batch - wraps importCustomersBatch with userId
  const handleCustomerImportBatch = useCallback(async (customers: Parameters<typeof importCustomersBatch>[0]) => {
    return importCustomersBatch(customers);
  }, []);

  // Geocoding state and handler
  const [isSubmittingGeocode, setIsSubmittingGeocode] = useState(false);
  
  const handleTriggerGeocode = useCallback(async () => {
    setIsSubmittingGeocode(true);
    try {
      const result = await submitGeocodeAllPending();
      if (result) {
        alert(t('admin_geocode_success', { jobId: result.jobId }));
      } else {
        alert(t('admin_geocode_none'));
      }
      // Refresh status after submission
      runHealthCheck();
    } catch (error) {
      alert(t('admin_geocode_error', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setIsSubmittingGeocode(false);
    }
  }, []);

  // Health check function
  const runHealthCheck = useCallback(async () => {
    setIsChecking(true);
    const newServices = [...services];
    
    // Check NATS (if we can make requests, NATS is working)
    const natsIdx = newServices.findIndex(s => s.name === 'NATS');
    if (natsIdx >= 0) {
      newServices[natsIdx] = {
        ...newServices[natsIdx],
        status: connected ? 'running' : 'error',
        lastCheck: new Date().toISOString(),
        details: connected ? 'WebSocket connected' : 'WebSocket disconnected'
      };
    }

    // Check Worker via ping
    try {
      const startTime = Date.now();
      await request<{ timestamp: number }, PingResponse>('sazinka.ping', { timestamp: startTime });
      const responseTime = Date.now() - startTime;
      const workerIdx = newServices.findIndex(s => s.name === 'Worker');
      if (workerIdx >= 0) {
        newServices[workerIdx] = {
          ...newServices[workerIdx],
          status: 'running',
          lastCheck: new Date().toISOString(),
          details: `Responded in ${responseTime}ms`
        };
      }
    } catch (e) {
      const workerIdx = newServices.findIndex(s => s.name === 'Worker');
      if (workerIdx >= 0) {
        newServices[workerIdx] = {
          ...newServices[workerIdx],
          status: 'error',
          lastCheck: new Date().toISOString(),
          details: String(e)
        };
      }
    }

    // Check PostgreSQL via admin endpoint
    try {
      const response = await request<unknown, ApiEnvelope<AdminDbStatus> | AdminDbStatus>('sazinka.admin.db.status', createRequest(getToken(), {}));
      const dbResult = unwrapPayload(response);
      const pgIdx = newServices.findIndex(s => s.name === 'PostgreSQL');
      if (pgIdx >= 0) {
        newServices[pgIdx] = {
          ...newServices[pgIdx],
          status: dbResult.connected ? 'running' : 'error',
          lastCheck: new Date().toISOString(),
          details: dbResult.connected ? `${dbResult.sizeHuman || dbResult.size_human}` : 'Connection failed'
        };
      }
      setDbInfo({
        size_bytes: dbResult.sizeBytes || dbResult.size_bytes || 0,
        size_human: dbResult.sizeHuman || dbResult.size_human || 'N/A',
        tables: dbResult.tables || [],
        connection_status: dbResult.connected ? 'connected' : 'disconnected'
      });
    } catch (e) {
      const pgIdx = newServices.findIndex(s => s.name === 'PostgreSQL');
      if (pgIdx >= 0) {
        newServices[pgIdx] = {
          ...newServices[pgIdx],
          status: 'error',
          lastCheck: new Date().toISOString(),
          details: String(e)
        };
      }
    }

    // Check Valhalla
    try {
      const response = await request<unknown, ApiEnvelope<AdminServiceAvailability> | AdminServiceAvailability>('sazinka.admin.valhalla.status', createRequest(getToken(), {}));
      const valhallaResult = unwrapPayload(response);
      const valhallaIdx = newServices.findIndex(s => s.name === 'Valhalla');
      if (valhallaIdx >= 0) {
        newServices[valhallaIdx] = {
          ...newServices[valhallaIdx],
          status: valhallaResult.available ? 'running' : 'stopped',
          lastCheck: new Date().toISOString(),
          details: valhallaResult.available ? valhallaResult.url : 'Not available'
        };
      }
    } catch (e) {
      const valhallaIdx = newServices.findIndex(s => s.name === 'Valhalla');
      if (valhallaIdx >= 0) {
        newServices[valhallaIdx] = {
          ...newServices[valhallaIdx],
          status: 'unknown',
          lastCheck: new Date().toISOString(),
          details: 'Could not check'
        };
      }
    }

    // Check Nominatim
    try {
      const response = await request<unknown, ApiEnvelope<AdminServiceAvailability> | AdminServiceAvailability>('sazinka.admin.nominatim.status', createRequest(getToken(), {}));
      const nominatimResult = unwrapPayload(response);
      const nominatimIdx = newServices.findIndex(s => s.name === 'Nominatim');
      if (nominatimIdx >= 0) {
        // If URL is configured but not available, it's likely importing/starting
        const isConfigured = nominatimResult.url && nominatimResult.url !== 'Not configured';
        const status = nominatimResult.available 
          ? 'running' 
          : (isConfigured ? 'starting' : 'stopped');
        const details = nominatimResult.available 
          ? `${nominatimResult.url}${nominatimResult.version ? ` v${nominatimResult.version}` : ''}`
          : (isConfigured ? 'Importing data / starting up...' : 'Not configured');
        newServices[nominatimIdx] = {
          ...newServices[nominatimIdx],
          status,
          lastCheck: new Date().toISOString(),
          details
        };
      }
    } catch (e) {
      const nominatimIdx = newServices.findIndex(s => s.name === 'Nominatim');
      if (nominatimIdx >= 0) {
        newServices[nominatimIdx] = {
          ...newServices[nominatimIdx],
          status: 'unknown',
          lastCheck: new Date().toISOString(),
          details: 'Could not check'
        };
      }
    }

    // Check JetStream
    try {
      const response = await request<unknown, ApiEnvelope<AdminJetStreamStatus> | AdminJetStreamStatus>('sazinka.admin.jetstream.status', createRequest(getToken(), {}));
      const jsResult = unwrapPayload(response);
      const jsIdx = newServices.findIndex(s => s.name === 'JetStream');
      if (jsIdx >= 0) {
        const streamInfo = jsResult.streams?.[0];
        const consumerInfo = jsResult.consumers?.[0];
        let details = jsResult.available ? 'Enabled' : 'Disabled';
        if (streamInfo) {
          details = `${streamInfo.messages} msgs, ${consumerInfo?.pending || 0} pending`;
        }
        newServices[jsIdx] = {
          ...newServices[jsIdx],
          status: jsResult.available ? 'running' : 'stopped',
          lastCheck: new Date().toISOString(),
          details
        };
      }
    } catch (e) {
      const jsIdx = newServices.findIndex(s => s.name === 'JetStream');
      if (jsIdx >= 0) {
        newServices[jsIdx] = {
          ...newServices[jsIdx],
          status: 'unknown',
          lastCheck: new Date().toISOString(),
          details: 'Could not check'
        };
      }
    }

    // Check Geocoding status
    try {
      const response = await request<unknown, ApiEnvelope<AdminGeocodeStatus> | AdminGeocodeStatus>('sazinka.admin.geocode.status', createRequest(getToken(), {}));
      const geocodeResult = unwrapPayload(response);
      const geocodeIdx = newServices.findIndex(s => s.name === 'Geocoding');
      if (geocodeIdx >= 0) {
        const pendingCustomers = geocodeResult.pendingCustomers || 0;
        const failedCustomers = geocodeResult.failedCustomers || 0;
        const queuedJobs = geocodeResult.streamMessages || 0;
        let details = `${pendingCustomers} pending`;
        if (failedCustomers > 0) {
          details += `, ${failedCustomers} ${t('admin_failed_count')}`;
        }
        details += `, ${queuedJobs} jobs queued`;
        newServices[geocodeIdx] = {
          ...newServices[geocodeIdx],
          status: geocodeResult.available ? 'running' : 'stopped',
          lastCheck: new Date().toISOString(),
          details
        };
      }
    } catch (e) {
      const geocodeIdx = newServices.findIndex(s => s.name === 'Geocoding');
      if (geocodeIdx >= 0) {
        newServices[geocodeIdx] = {
          ...newServices[geocodeIdx],
          status: 'unknown',
          lastCheck: new Date().toISOString(),
          details: 'Could not check'
        };
      }
    }

    setServices(newServices);
    setIsChecking(false);
  }, [connected, request, services]);

  // Load logs
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

  // Reset database
  const resetDatabase = async () => {
    if (!confirm(t('admin_db_confirm_reset'))) {
      return;
    }
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

  // Initial health check
  useEffect(() => {
    if (connected) {
      runHealthCheck();
      loadLogs();
    }
  }, [connected]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && connected) {
      const interval = setInterval(() => {
        runHealthCheck();
        loadLogs();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, connected, runHealthCheck, loadLogs]);

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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>{t('admin_title')}</h1>
        <div className={styles.headerActions}>
          <label className={styles.autoRefresh}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {t('admin_auto_refresh')}
          </label>
        </div>
      </div>

      {/* Services Status Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>{t('admin_services_title')}</h2>
          <button 
            type="button"
            className={styles.primaryButton}
            onClick={runHealthCheck}
            disabled={isChecking || !connected}
          >
            {isChecking ? t('admin_checking') : t('admin_health_check')}
          </button>
        </div>

        <div className={styles.servicesGrid}>
          {services.map((service) => (
            <div key={service.name} className={styles.serviceCard}>
              <div className={styles.serviceHeader}>
                <span className={`${styles.statusIndicator} ${getStatusColor(service.status)}`}>
                  {getStatusIcon(service.status)}
                </span>
                <span className={styles.serviceName}>{service.name}</span>
              </div>
              <div className={styles.serviceDetails}>
                <span className={styles.serviceStatus}>{service.status}</span>
                {service.details && (
                  <span className={styles.serviceInfo}>{service.details}</span>
                )}
                {service.lastCheck && (
                  <span className={styles.lastCheck}>
                    {t('admin_last_check')} {formatTime(service.lastCheck)}
                  </span>
                )}
              </div>
              <div className={styles.serviceActions}>
                {service.name === 'Geocoding' ? (
                  <button 
                    className={styles.smallButton}
                    onClick={handleTriggerGeocode}
                    disabled={isSubmittingGeocode || !connected}
                    title={t('admin_geocode_trigger')}
                  >
                    {isSubmittingGeocode ? t('admin_geocode_submitting') : t('admin_geocode_run')}
                  </button>
                ) : (
                  <button 
                    className={styles.smallButton}
                    disabled={service.name === 'Frontend'}
                    title={t('admin_restart_title')}
                  >
                    {t('admin_restart')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Database Section */}
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
              <button 
                type="button"
                className={styles.dangerButton}
                onClick={resetDatabase}
                disabled={isResettingDb}
              >
                {isResettingDb ? t('admin_db_resetting') : t('admin_db_reset')}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.noData}>
            {t('admin_db_loading')}
          </div>
        )}
      </section>

      {/* Export Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>{t('admin_export_title')}</h2>
        </div>
        {runningExportJobs.length > 0 && (
          <div className={styles.runningJobNotice}>
            {runningExportJobs.map(job => (
              <div key={job.id} className={styles.runningJobRow}>
                <span className={styles.runningJobPulse} />
                <span>{i18n.t('jobs:running_job_notice', { name: job.name })}</span>
                {job.progressText && <span className={styles.runningJobProgress}>{job.progressText}</span>}
                <Link to="/jobs" className={styles.runningJobLink}>{i18n.t('jobs:go_to_jobs')} &rarr;</Link>
              </div>
            ))}
          </div>
        )}
        <ExportPlusPanel adminMode />
      </section>

      {/* Import Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>{t('admin_import_title')}</h2>
        </div>
        {runningImportJobs.length > 0 && (
          <div className={styles.runningJobNotice}>
            {runningImportJobs.map(job => (
              <div key={job.id} className={styles.runningJobRow}>
                <span className={styles.runningJobPulse} />
                <span>{i18n.t('jobs:running_job_notice', { name: job.name })}</span>
                {job.progressText && <span className={styles.runningJobProgress}>{job.progressText}</span>}
                <Link to="/jobs" className={styles.runningJobLink}>{i18n.t('jobs:go_to_jobs')} &rarr;</Link>
              </div>
            ))}
          </div>
        )}

        <div className={styles.exportContainer}>
          {/* Customers Import */}
          <div className={styles.exportCard}>
            <h3>{t('admin_import_customers_title')}</h3>
            <p className={styles.exportDescription}>
              {t('admin_import_customers_desc')}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleOpenCustomerImport}
              disabled={!connected}
            >
              {t('admin_import_customers_btn')}
            </button>
          </div>

          {/* Devices Import */}
          <div className={styles.exportCard}>
            <h3>{t('admin_import_devices_title')}</h3>
            <p className={styles.exportDescription}>
              {t('admin_import_devices_desc')}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('device')}
              disabled={!connected}
            >
              {t('admin_import_devices_btn')}
            </button>
          </div>

          {/* Revisions Import */}
          <div className={styles.exportCard}>
            <h3>{t('admin_import_revisions_title')}</h3>
            <p className={styles.exportDescription}>
              {t('admin_import_revisions_desc')}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('revision')}
              disabled={!connected}
            >
              {t('admin_import_revisions_btn')}
            </button>
          </div>

          {/* Communications Import */}
          <div className={styles.exportCard}>
            <h3>{t('admin_import_comm_title')}</h3>
            <p className={styles.exportDescription}>
              {t('admin_import_comm_desc')}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('communication')}
              disabled={!connected}
            >
              {t('admin_import_comm_btn')}
            </button>
          </div>

          {/* Visits Import */}
          <div className={styles.exportCard}>
            <h3>{t('admin_import_worklog_title')}</h3>
            <p className={styles.exportDescription}>
              {t('admin_import_worklog_desc')}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('work_log')}
              disabled={!connected}
            >
              {t('admin_import_worklog_btn')}
            </button>
          </div>

          {/* ZIP Import */}
          <div className={styles.exportCard}>
            <h3>{t('admin_import_zip_title')}</h3>
            <p className={styles.exportDescription}>
              {t('admin_import_zip_desc')}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('zip')}
              disabled={!connected}
            >
              {t('admin_import_zip_btn')}
            </button>
          </div>
        </div>

        <div className={styles.importHint}>
          <p>
            📋 <a href="/PROJECT_IMPORT.MD" target="_blank" rel="noopener noreferrer">
              {t('admin_import_docs')}
            </a>
          </p>
          <p>
            {t('admin_import_order_hint')}
          </p>
        </div>
      </section>

      {/* Import Modal */}
      <ImportModal
        isOpen={importModalOpen}
        onClose={handleCloseImport}
        entityType={importEntityType}
        onComplete={() => runHealthCheck()}
      />

      {/* Customer Import Modal */}
      <ImportCustomersModal
        isOpen={showCustomerImport}
        onClose={handleCloseCustomerImport}
      />

      {/* Logs Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>{t('admin_logs_title')}</h2>
          <div className={styles.logControls}>
            <select 
              value={logFilter} 
              onChange={(e) => setLogFilter(e.target.value)}
              className={styles.select}
            >
              <option value="all">{t('admin_logs_all')}</option>
              <option value="error">{t('admin_logs_error')}</option>
              <option value="warn">{t('admin_logs_warn')}</option>
              <option value="info">{t('admin_logs_info')}</option>
              <option value="debug">{t('admin_logs_debug')}</option>
            </select>
            <button 
              type="button"
              className={styles.secondaryButton}
              onClick={loadLogs}
              disabled={isLoadingLogs}
            >
              {isLoadingLogs ? t('admin_logs_loading') : t('admin_logs_refresh')}
            </button>
          </div>
        </div>

        <div className={styles.logsContainer}>
          {logs.length > 0 ? (
            <div className={styles.logsList}>
              {logs.map((log, index) => (
                <div 
                  key={index} 
                  className={`${styles.logEntry} ${styles[`log${log.level.charAt(0).toUpperCase() + log.level.slice(1)}`]}`}
                >
                  <span className={styles.logTime}>
                    {formatTime(log.timestamp)}
                  </span>
                  <span className={styles.logLevel}>{log.level.toUpperCase()}</span>
                  {log.target && <span className={styles.logTarget}>{log.target}</span>}
                  <span className={styles.logMessage}>{log.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.noData}>
              {isLoadingLogs ? t('admin_logs_loading_text') : t('admin_logs_empty')}
            </div>
          )}
        </div>
      </section>

      {/* Connection Status Banner */}
      {!connected && (
        <div className={styles.connectionBanner}>
          {t('admin_not_connected')}
        </div>
      )}
    </div>
  );
}

export default Admin;
