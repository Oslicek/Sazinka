import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../stores/natsStore';
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
      case 'stopped': return styles.statusStopped;
      case 'error': return styles.statusError;
      default: return styles.statusUnknown;
    }
  };

  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'running': return '●';
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
