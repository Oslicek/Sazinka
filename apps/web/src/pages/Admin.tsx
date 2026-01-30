import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../stores/natsStore';
import * as exportService from '../services/exportService';
import { importCustomersBatch } from '../services/customerService';
import { ImportModal, type ImportEntityType } from '../components/import';
import { ImportCustomersModal } from '../components/customers/ImportCustomersModal';
import styles from './Admin.module.css';

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
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

export function Admin() {
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
  
  // Export state
  const [isExportingCustomers, setIsExportingCustomers] = useState(false);
  const [isExportingRevisions, setIsExportingRevisions] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportStatus, setExportStatus] = useState<string>('all');
  
  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importEntityType, setImportEntityType] = useState<ImportEntityType>('device');
  const [showCustomerImport, setShowCustomerImport] = useState(false);
  
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
  const handleCustomerImportBatch = useCallback(async (customers: Parameters<typeof importCustomersBatch>[1]) => {
    const USER_ID = '00000000-0000-0000-0000-000000000001';
    return importCustomersBatch(USER_ID, customers);
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
      const pingResponse = await request<any, any>('sazinka.ping', { timestamp: startTime });
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
      const response = await request<any, any>('sazinka.admin.db.status', {});
      // Response is wrapped in { id, timestamp, payload: {...} }
      const dbResult = response.payload || response;
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
      const response = await request<any, any>('sazinka.admin.valhalla.status', {});
      const valhallaResult = response.payload || response;
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
      const response = await request<any, any>('sazinka.admin.nominatim.status', {});
      const nominatimResult = response.payload || response;
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
      const response = await request<any, any>('sazinka.admin.jetstream.status', {});
      const jsResult = response.payload || response;
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
      const response = await request<any, any>('sazinka.admin.geocode.status', {});
      const geocodeResult = response.payload || response;
      const geocodeIdx = newServices.findIndex(s => s.name === 'Geocoding');
      if (geocodeIdx >= 0) {
        const pendingCustomers = geocodeResult.pendingCustomers || 0;
        const queuedJobs = geocodeResult.streamMessages || 0;
        newServices[geocodeIdx] = {
          ...newServices[geocodeIdx],
          status: geocodeResult.available ? 'running' : 'stopped',
          lastCheck: new Date().toISOString(),
          details: `${pendingCustomers} pending, ${queuedJobs} jobs queued`
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
      const response = await request<any, any>('sazinka.admin.logs', { limit: 100, level: logFilter });
      // Response is wrapped in { id, timestamp, payload: { logs: [...] } }
      const result = response.payload || response;
      setLogs(result.logs || []);
    } catch (e) {
      console.error('Failed to load logs:', e);
    }
    setIsLoadingLogs(false);
  }, [request, logFilter]);

  // Reset database
  const resetDatabase = async () => {
    if (!confirm('Opravdu chcete smazat a znovu vytvořit databázi? Všechna data budou ztracena!')) {
      return;
    }
    setIsResettingDb(true);
    try {
      await request('sazinka.admin.db.reset', {});
      alert('Databáze byla resetována.');
      runHealthCheck();
    } catch (e) {
      alert('Chyba při resetování databáze: ' + String(e));
    }
    setIsResettingDb(false);
  };

  // Export customers
  const handleExportCustomers = async () => {
    setIsExportingCustomers(true);
    try {
      await exportService.exportCustomers();
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export zákazníků selhal: ' + String(e));
    }
    setIsExportingCustomers(false);
  };

  // Export revisions
  const handleExportRevisions = async () => {
    setIsExportingRevisions(true);
    try {
      await exportService.exportRevisions({
        dateFrom: exportDateFrom || undefined,
        dateTo: exportDateTo || undefined,
        status: exportStatus !== 'all' ? exportStatus : undefined,
      });
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export revizí selhal: ' + String(e));
    }
    setIsExportingRevisions(false);
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
        <h1>Administrace systému</h1>
        <div className={styles.headerActions}>
          <label className={styles.autoRefresh}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (5s)
          </label>
        </div>
      </div>

      {/* Services Status Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Stav služeb</h2>
          <button 
            type="button"
            className={styles.primaryButton}
            onClick={runHealthCheck}
            disabled={isChecking || !connected}
          >
            {isChecking ? 'Kontroluji...' : 'Spustit health check'}
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
                    Poslední kontrola: {new Date(service.lastCheck).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div className={styles.serviceActions}>
                <button 
                  className={styles.smallButton}
                  disabled={service.name === 'Frontend'}
                  title="Restartovat službu"
                >
                  ↻ Restart
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Database Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Databáze</h2>
        </div>

        {dbInfo ? (
          <div className={styles.dbInfo}>
            <div className={styles.dbStats}>
              <div className={styles.dbStat}>
                <span className={styles.dbStatLabel}>Velikost</span>
                <span className={styles.dbStatValue}>{dbInfo.size_human}</span>
              </div>
              <div className={styles.dbStat}>
                <span className={styles.dbStatLabel}>Stav</span>
                <span className={`${styles.dbStatValue} ${dbInfo.connection_status === 'connected' ? styles.textGreen : styles.textRed}`}>
                  {dbInfo.connection_status === 'connected' ? 'Připojeno' : 'Odpojeno'}
                </span>
              </div>
            </div>

            {dbInfo.tables && dbInfo.tables.length > 0 && (
              <div className={styles.tablesContainer}>
                <h3>Tabulky</h3>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Název</th>
                      <th>Řádků</th>
                      <th>Velikost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbInfo.tables.map((table) => (
                      <tr key={table.name}>
                        <td>{table.name}</td>
                        <td>{table.rows.toLocaleString()}</td>
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
                {isResettingDb ? 'Resetuji...' : 'Smazat a znovu vytvořit databázi'}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.noData}>
            Načítám informace o databázi...
          </div>
        )}
      </section>

      {/* Export Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Export dat</h2>
        </div>

        <div className={styles.exportContainer}>
          {/* Customers Export */}
          <div className={styles.exportCard}>
            <h3>Export zákazníků</h3>
            <p className={styles.exportDescription}>
              Exportuje všechny zákazníky do CSV souboru ve formátu kompatibilním s importem.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleExportCustomers}
              disabled={isExportingCustomers || !connected}
            >
              {isExportingCustomers ? 'Exportuji...' : '📥 Exportovat zákazníky'}
            </button>
          </div>

          {/* Revisions Export */}
          <div className={styles.exportCard}>
            <h3>Export revizí</h3>
            <p className={styles.exportDescription}>
              Exportuje revize do CSV souboru. Můžete filtrovat podle data a stavu.
            </p>
            
            <div className={styles.exportFilters}>
              <div className={styles.filterGroup}>
                <label>Od data</label>
                <input
                  type="date"
                  value={exportDateFrom}
                  onChange={(e) => setExportDateFrom(e.target.value)}
                />
              </div>
              <div className={styles.filterGroup}>
                <label>Do data</label>
                <input
                  type="date"
                  value={exportDateTo}
                  onChange={(e) => setExportDateTo(e.target.value)}
                />
              </div>
              <div className={styles.filterGroup}>
                <label>Stav</label>
                <select
                  value={exportStatus}
                  onChange={(e) => setExportStatus(e.target.value)}
                >
                  <option value="all">Všechny</option>
                  <option value="pending">Čekající</option>
                  <option value="scheduled">Naplánované</option>
                  <option value="completed">Dokončené</option>
                  <option value="cancelled">Zrušené</option>
                </select>
              </div>
            </div>
            
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleExportRevisions}
              disabled={isExportingRevisions || !connected}
            >
              {isExportingRevisions ? 'Exportuji...' : '📥 Exportovat revize'}
            </button>
          </div>
        </div>
      </section>

      {/* Import Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Import dat</h2>
        </div>

        <div className={styles.exportContainer}>
          {/* Customers Import */}
          <div className={styles.exportCard}>
            <h3>1. Import zákazníků</h3>
            <p className={styles.exportDescription}>
              Importuje zákazníky z CSV. Automaticky spustí geokódování adres.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleOpenCustomerImport}
              disabled={!connected}
            >
              📤 Importovat zákazníky
            </button>
          </div>

          {/* Devices Import */}
          <div className={styles.exportCard}>
            <h3>2. Import zařízení</h3>
            <p className={styles.exportDescription}>
              Importuje zařízení z CSV. Vyžaduje existující zákazníky (propojení přes IČO/email/telefon).
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('device')}
              disabled={!connected}
            >
              📤 Importovat zařízení
            </button>
          </div>

          {/* Revisions Import */}
          <div className={styles.exportCard}>
            <h3>3. Import revizí</h3>
            <p className={styles.exportDescription}>
              Importuje revize z CSV. Vyžaduje existující zařízení (propojení přes sériové číslo).
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('revision')}
              disabled={!connected}
            >
              📤 Importovat revize
            </button>
          </div>

          {/* Communications Import */}
          <div className={styles.exportCard}>
            <h3>4. Import komunikace</h3>
            <p className={styles.exportDescription}>
              Importuje historii komunikace (hovory, emaily, poznámky) z CSV.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('communication')}
              disabled={!connected}
            >
              📤 Importovat komunikaci
            </button>
          </div>

          {/* Visits Import */}
          <div className={styles.exportCard}>
            <h3>5. Import návštěv</h3>
            <p className={styles.exportDescription}>
              Importuje historii návštěv z CSV.
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => handleOpenImport('visit')}
              disabled={!connected}
            >
              📤 Importovat návštěvy
            </button>
          </div>
        </div>

        <div className={styles.importHint}>
          <p>
            📋 <a href="/IMPORT_FORMAT.MD" target="_blank" rel="noopener noreferrer">
              Dokumentace formátů CSV pro import
            </a>
          </p>
          <p>
            Importujte v uvedeném pořadí (1-5). Každý import vyžaduje data z předchozích kroků.
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
        onImportBatch={handleCustomerImportBatch}
      />

      {/* Logs Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Logy</h2>
          <div className={styles.logControls}>
            <select 
              value={logFilter} 
              onChange={(e) => setLogFilter(e.target.value)}
              className={styles.select}
            >
              <option value="all">Všechny úrovně</option>
              <option value="error">Pouze chyby</option>
              <option value="warn">Varování a výše</option>
              <option value="info">Info a výše</option>
              <option value="debug">Debug a výše</option>
            </select>
            <button 
              type="button"
              className={styles.secondaryButton}
              onClick={loadLogs}
              disabled={isLoadingLogs}
            >
              {isLoadingLogs ? 'Načítám...' : 'Obnovit logy'}
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
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={styles.logLevel}>{log.level.toUpperCase()}</span>
                  {log.target && <span className={styles.logTarget}>{log.target}</span>}
                  <span className={styles.logMessage}>{log.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.noData}>
              {isLoadingLogs ? 'Načítám logy...' : 'Žádné logy k zobrazení'}
            </div>
          )}
        </div>
      </section>

      {/* Connection Status Banner */}
      {!connected && (
        <div className={styles.connectionBanner}>
          ⚠️ Nejste připojeni k NATS serveru. Některé funkce nebudou dostupné.
        </div>
      )}
    </div>
  );
}

export default Admin;
