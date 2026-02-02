import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '@/stores/natsStore';
import { JobStatusTimeline } from '../components/common';
import { 
  type JobType, 
  type JobStatus, 
  type JobStatusUpdate,
  getJobTypeName, 
  getJobTypeIcon,
  isActive,
  isTerminal,
} from '../types/jobStatus';
import { cancelJob, retryJob, listJobHistory, type JobHistoryEntry } from '../services/jobService';
import styles from './Jobs.module.css';

/** Active job entry in the dashboard */
interface ActiveJob {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: Date;
  lastUpdate: Date;
}

/** Completed/failed job entry */
interface CompletedJob extends ActiveJob {
  completedAt: Date;
  duration: number; // ms
}

/** All job streams to monitor */
const JOB_STREAMS: JobType[] = [
  'geocode',
  'route',
  'import',
  'export',
  'valhalla.matrix',
  'valhalla.geometry',
  'email',
  'sms',
];

export function Jobs() {
  const isConnected = useNatsStore((s) => s.isConnected);
  const subscribe = useNatsStore((s) => s.subscribe);
  
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJob>>(new Map());
  const [recentJobs, setRecentJobs] = useState<CompletedJob[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Load job history on mount
  useEffect(() => {
    if (!isConnected) return;
    
    const loadHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const response = await listJobHistory({ limit: 50 });
        
        // Convert backend format to CompletedJob format
        const jobs: CompletedJob[] = response.jobs.map((entry: JobHistoryEntry) => ({
          id: entry.id,
          type: entry.jobType as JobType,
          status: entry.status === 'completed' 
            ? { type: 'completed' as const }
            : { type: 'failed' as const, error: entry.error || 'Unknown error' },
          startedAt: new Date(entry.startedAt),
          lastUpdate: new Date(entry.completedAt),
          completedAt: new Date(entry.completedAt),
          duration: entry.durationMs,
        }));
        
        setRecentJobs(jobs);
      } catch (err) {
        console.error('Failed to load job history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    };
    
    loadHistory();
  }, [isConnected]);
  
  // Handle cancel job
  const handleCancelJob = useCallback(async (jobId: string, jobType: JobType) => {
    setActionLoading(jobId);
    setActionError(null);
    
    try {
      const result = await cancelJob(jobId, jobType);
      if (!result.success) {
        setActionError(result.message);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Nepodařilo se zrušit úlohu');
    } finally {
      setActionLoading(null);
    }
  }, []);
  
  // Handle retry job
  const handleRetryJob = useCallback(async (jobId: string, jobType: JobType) => {
    setActionLoading(jobId);
    setActionError(null);
    
    try {
      const result = await retryJob(jobId, jobType);
      if (!result.success) {
        setActionError(result.message);
      } else {
        // Remove from recent jobs list since it's being retried
        setRecentJobs(prev => prev.filter(j => j.id !== jobId));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Nepodařilo se opakovat úlohu');
    } finally {
      setActionLoading(null);
    }
  }, []);
  
  
  // Handle job status updates
  const handleStatusUpdate = useCallback((type: JobType, update: JobStatusUpdate) => {
    const jobId = update.jobId;
    const status = update.status;
    
    setActiveJobs(prev => {
      const next = new Map(prev);
      
      if (isTerminal(status)) {
        // Move to completed/failed
        const activeJob = next.get(jobId);
        if (activeJob) {
          const completedJob: CompletedJob = {
            ...activeJob,
            status,
            lastUpdate: new Date(update.timestamp),
            completedAt: new Date(update.timestamp),
            duration: new Date(update.timestamp).getTime() - activeJob.startedAt.getTime(),
          };
          
          setRecentJobs(prevRecent => {
            // Keep only last 50 completed jobs
            const updated = [completedJob, ...prevRecent].slice(0, 50);
            return updated;
          });
        }
        next.delete(jobId);
      } else if (isActive(status)) {
        // Update or create active job
        const existing = next.get(jobId);
        if (existing) {
          next.set(jobId, {
            ...existing,
            status,
            lastUpdate: new Date(update.timestamp),
          });
        } else {
          next.set(jobId, {
            id: jobId,
            type,
            status,
            startedAt: new Date(update.timestamp),
            lastUpdate: new Date(update.timestamp),
          });
        }
      }
      
      return next;
    });
  }, []);
  
  // Subscribe to all job status streams
  useEffect(() => {
    if (!isConnected) return;
    
    const unsubscribes: (() => void)[] = [];
    
    const setupSubscriptions = async () => {
      for (const jobType of JOB_STREAMS) {
        try {
          // Subscribe to all status updates for this job type
          // Using wildcard pattern: sazinka.job.{type}.status.*
          const subject = `sazinka.job.${jobType}.status.*`;
          const unsub = await subscribe<JobStatusUpdate>(
            subject,
            (update) => handleStatusUpdate(jobType, update)
          );
          unsubscribes.push(unsub);
        } catch (err) {
          console.error(`Failed to subscribe to ${jobType} jobs:`, err);
        }
      }
    };
    
    setupSubscriptions();
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [isConnected, subscribe, handleStatusUpdate]);
  
  // Filter jobs for display
  const activeJobsList = Array.from(activeJobs.values());
  const displayedActiveJobs = activeJobsList;
  const displayedRecentJobs = recentJobs.filter(job => {
    if (filter === 'completed') return job.status.type === 'completed';
    if (filter === 'failed') return job.status.type === 'failed';
    return true;
  });
  
  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };
  
  // Format time ago
  const formatTimeAgo = (date: Date): string => {
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return 'právě teď';
    if (diff < 3600000) return `před ${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `před ${Math.floor(diff / 3600000)}h`;
    return date.toLocaleDateString('cs-CZ');
  };
  
  return (
    <div className={styles.jobs}>
      <h1>Úlohy na pozadí</h1>
      
      {!isConnected && (
        <div className={styles.warning}>
          Nejste připojeni k serveru. Úlohy se nezobrazují v reálném čase.
        </div>
      )}
      
      {actionError && (
        <div className={styles.error}>
          {actionError}
          <button onClick={() => setActionError(null)} className={styles.dismissBtn}>×</button>
        </div>
      )}
      
      {/* Active Jobs Section */}
      <section className={styles.section}>
        <h2>
          Aktivní úlohy
          {activeJobsList.length > 0 && (
            <span className={styles.badge}>{activeJobsList.length}</span>
          )}
        </h2>
        
        {activeJobsList.length === 0 ? (
          <div className={styles.empty}>
            Žádné aktivní úlohy
          </div>
        ) : (
          <div className={styles.jobsList}>
            {displayedActiveJobs.map(job => (
              <div key={job.id} className={styles.jobCard}>
                <div className={styles.jobHeader}>
                  <span className={styles.jobIcon}>{getJobTypeIcon(job.type)}</span>
                  <span className={styles.jobType}>{getJobTypeName(job.type)}</span>
                  <span className={styles.jobId}>#{job.id.slice(0, 8)}</span>
                  <button
                    className={styles.cancelBtn}
                    onClick={() => handleCancelJob(job.id, job.type)}
                    disabled={actionLoading === job.id}
                    title="Zrušit úlohu"
                  >
                    {actionLoading === job.id ? '...' : '×'}
                  </button>
                </div>
                
                <JobStatusTimeline 
                  status={job.status} 
                  size="sm"
                  showProgress
                />
                
                <div className={styles.jobMeta}>
                  <span>Spuštěno: {formatTimeAgo(job.startedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      
      {/* Recent Jobs Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Historie úloh</h2>
          
          <div className={styles.filterTabs}>
            <button 
              className={filter === 'all' ? styles.activeTab : ''}
              onClick={() => setFilter('all')}
            >
              Vše
            </button>
            <button 
              className={filter === 'completed' ? styles.activeTab : ''}
              onClick={() => setFilter('completed')}
            >
              Dokončené
            </button>
            <button 
              className={filter === 'failed' ? styles.activeTab : ''}
              onClick={() => setFilter('failed')}
            >
              Selhané
            </button>
          </div>
        </div>
        
        {isLoadingHistory ? (
          <div className={styles.empty}>
            Načítání historie...
          </div>
        ) : displayedRecentJobs.length === 0 ? (
          <div className={styles.empty}>
            Žádné záznamy
          </div>
        ) : (
          <div className={styles.recentList}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Typ</th>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Trvání</th>
                  <th>Dokončeno</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {displayedRecentJobs.map(job => (
                  <tr key={job.id} className={job.status.type === 'failed' ? styles.failedRow : ''}>
                    <td>
                      <span className={styles.tableIcon}>{getJobTypeIcon(job.type)}</span>
                      {getJobTypeName(job.type)}
                    </td>
                    <td className={styles.mono}>#{job.id.slice(0, 8)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[job.status.type]}`}>
                        {job.status.type === 'completed' ? 'Hotovo' : 'Selhalo'}
                      </span>
                    </td>
                    <td>{formatDuration(job.duration)}</td>
                    <td>{formatTimeAgo(job.completedAt)}</td>
                    <td>
                      {job.status.type === 'failed' && (
                        <button
                          className={styles.retryBtn}
                          onClick={() => handleRetryJob(job.id, job.type)}
                          disabled={actionLoading === job.id}
                        >
                          {actionLoading === job.id ? '...' : 'Opakovat'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      
      {/* Summary Stats */}
      <section className={styles.section}>
        <h2>Přehled</h2>
        <div className={styles.statsGrid}>
          {JOB_STREAMS.map(jobType => {
            const activeCount = activeJobsList.filter(j => j.type === jobType).length;
            const completedCount = recentJobs.filter(j => j.type === jobType && j.status.type === 'completed').length;
            const failedCount = recentJobs.filter(j => j.type === jobType && j.status.type === 'failed').length;
            
            if (activeCount === 0 && completedCount === 0 && failedCount === 0) return null;
            
            return (
              <div key={jobType} className={styles.statCard}>
                <div className={styles.statHeader}>
                  <span className={styles.statIcon}>{getJobTypeIcon(jobType)}</span>
                  <span className={styles.statType}>{getJobTypeName(jobType)}</span>
                </div>
                <div className={styles.statNumbers}>
                  {activeCount > 0 && (
                    <span className={styles.statActive}>{activeCount} aktivní</span>
                  )}
                  {completedCount > 0 && (
                    <span className={styles.statCompleted}>{completedCount} hotových</span>
                  )}
                  {failedCount > 0 && (
                    <span className={styles.statFailed}>{failedCount} selhání</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
