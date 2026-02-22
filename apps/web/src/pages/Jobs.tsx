import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '@/stores/natsStore';
import { useActiveJobsStore } from '@/stores/activeJobsStore';
import { JobStatusTimeline } from '../components/common';
import { ImportReportDialog } from '../components/import';
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
import { downloadExportJob } from '@/services/exportPlusService';
import type { CustomerImportJobStatusUpdate, ImportReport } from '@shared/import';
import { formatDate } from '../i18n/formatters';
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
  report?: ImportReport;
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
  const { t } = useTranslation('jobs');
  const isConnected = useNatsStore((s) => s.isConnected);
  const subscribe = useNatsStore((s) => s.subscribe);
  
  // Get jobs from the global active jobs store
  const globalActiveJobs = useActiveJobsStore((s) => s.jobs);
  
  const [localActiveJobs, setLocalActiveJobs] = useState<Map<string, ActiveJob>>(new Map());
  const [recentJobs, setRecentJobs] = useState<CompletedJob[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed' | 'cancelled'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [reportDialogData, setReportDialogData] = useState<ImportReport | null>(null);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);
  
  // Merge local active jobs with global active jobs from store
  const activeJobs = new Map(localActiveJobs);
  for (const [id, job] of globalActiveJobs) {
    if (!activeJobs.has(id) && (job.status === 'queued' || job.status === 'processing')) {
      activeJobs.set(id, {
        id: job.id,
        type: job.type as JobType,
        status: job.status === 'queued' 
          ? { type: 'queued' } 
          : { type: 'processing', progress: job.progress, message: job.progressText },
        startedAt: job.startedAt,
        lastUpdate: new Date(),
      });
    }
  }
  
  // Setter for local active jobs to match existing code pattern
  const setActiveJobs = setLocalActiveJobs;
  
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
            : entry.status === 'cancelled'
            ? { type: 'cancelled' as const }
            : { type: 'failed' as const, error: entry.error || 'Unknown error' },
          startedAt: new Date(entry.startedAt),
          lastUpdate: new Date(entry.completedAt),
          completedAt: new Date(entry.completedAt),
          duration: entry.durationMs,
          report: entry.report,
        }));
        
        // Merge with any jobs already added via real-time updates, dedup by ID
        setRecentJobs(prev => {
          const merged = new Map<string, CompletedJob>();
          // Real-time entries take priority (fresher data)
          for (const j of prev) merged.set(j.id, j);
          // Backend entries fill in anything not yet seen
          for (const j of jobs) {
            if (!merged.has(j.id)) merged.set(j.id, j);
          }
          return [...merged.values()]
            .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
            .slice(0, 50);
        });
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
      setActionError(err instanceof Error ? err.message : t('error_cancel'));
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
      setActionError(err instanceof Error ? err.message : t('error_retry'));
    } finally {
      setActionLoading(null);
    }
  }, []);

  // Handle export download from job history
  const handleDownloadExport = useCallback(async (jobId: string) => {
    setDownloadingExportId(jobId);
    setActionError(null);

    try {
      const { blob, filename } = await downloadExportJob(jobId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('error_download'));
    } finally {
      setDownloadingExportId(null);
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
            // Deduplicate by job ID, keep only last 50
            const withoutDup = prevRecent.filter(j => j.id !== jobId);
            return [completedJob, ...withoutDup].slice(0, 50);
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
  
  // Convert customer import status to generic JobStatus
  const convertImportStatus = useCallback((update: CustomerImportJobStatusUpdate): JobStatusUpdate => {
    const status = update.status;
    let jobStatus: JobStatus;
    
    if (status.type === 'queued') {
      jobStatus = { type: 'queued', position: status.position };
    } else if (status.type === 'parsing') {
      jobStatus = { type: 'processing', progress: status.progress, message: t('parsing_csv') };
    } else if (status.type === 'importing') {
      jobStatus = { 
        type: 'processing', 
        progress: Math.round((status.processed / status.total) * 100),
        processed: status.processed,
        total: status.total,
        message: t('import_progress', { succeeded: status.succeeded, failed: status.failed })
      };
    } else if (status.type === 'completed') {
      jobStatus = { type: 'completed', result: { succeeded: status.succeeded, failed: status.failed, total: status.total } };
    } else if (status.type === 'cancelled') {
      jobStatus = { type: 'cancelled' };
    } else if (status.type === 'failed') {
      jobStatus = { type: 'failed', error: status.error };
    } else {
      jobStatus = { type: 'processing' };
    }
    
    return {
      jobId: update.jobId,
      timestamp: update.timestamp,
      status: jobStatus,
    };
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
      
      // Also subscribe to customer import jobs with different subject pattern
      try {
        const unsub = await subscribe<CustomerImportJobStatusUpdate>(
          'sazinka.job.import.status.*',
          (update) => {
            const converted = convertImportStatus(update);
            handleStatusUpdate('import', converted);
          }
        );
        unsubscribes.push(unsub);
      } catch (err) {
        console.error('Failed to subscribe to customer import jobs:', err);
      }
    };
    
    setupSubscriptions();
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [isConnected, subscribe, handleStatusUpdate, convertImportStatus]);
  
  // Filter jobs for display
  const activeJobsList = Array.from(activeJobs.values());
  const displayedActiveJobs = activeJobsList;
  const displayedRecentJobs = recentJobs.filter(job => {
    if (filter === 'completed') return job.status.type === 'completed';
    if (filter === 'failed') return job.status.type === 'failed';
    if (filter === 'cancelled') return job.status.type === 'cancelled';
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
    if (diff < 60000) return t('time_just_now');
    if (diff < 3600000) return t('time_minutes_ago', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('time_hours_ago', { count: Math.floor(diff / 3600000) });
    return formatDate(date);
  };
  
  return (
    <div className={styles.jobs}>
      <h1>{t('title')}</h1>
      
      {!isConnected && (
        <div className={styles.warning}>
          {t('not_connected')}
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
          {t('active_title')}
          {activeJobsList.length > 0 && (
            <span className={styles.badge}>{activeJobsList.length}</span>
          )}
        </h2>
        
        {activeJobsList.length === 0 ? (
          <div className={styles.empty}>
            {t('active_empty')}
          </div>
        ) : (
          <div className={styles.jobsList}>
            {displayedActiveJobs.map(job => (
              <div key={job.id} className={styles.jobCard}>
                <div className={styles.jobHeader}>
                  <span className={styles.jobIcon}>{getJobTypeIcon(job.type)}</span>
                  <span className={styles.jobType}>{getJobTypeName(job.type)}</span>
                  <span className={styles.jobId}>#{job.id.slice(0, 8)}</span>

                  {confirmingCancelId === job.id ? (
                    <div className={styles.confirmInline}>
                      <span className={styles.confirmText}>{t('stop_job_confirm')}</span>
                      <button
                        className={styles.confirmYes}
                        onClick={() => {
                          setConfirmingCancelId(null);
                          handleCancelJob(job.id, job.type);
                        }}
                        disabled={actionLoading === job.id}
                      >
                        {t('stop_job_yes')}
                      </button>
                      <button
                        className={styles.confirmNo}
                        onClick={() => setConfirmingCancelId(null)}
                      >
                        {t('stop_job_no')}
                      </button>
                    </div>
                  ) : (
                    <button
                      className={styles.stopBtn}
                      onClick={() => setConfirmingCancelId(job.id)}
                      disabled={actionLoading === job.id}
                    >
                      {actionLoading === job.id ? (
                        <span className={styles.stopBtnSpinner} />
                      ) : (
                        <>&#9632; {t('stop_job')}</>
                      )}
                    </button>
                  )}
                </div>
                
                <JobStatusTimeline 
                  status={job.status} 
                  size="sm"
                  showProgress
                />
                
                <div className={styles.jobMeta}>
                  <span>{t('started')} {formatTimeAgo(job.startedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      
      {/* Recent Jobs Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>{t('history_title')}</h2>
          
          <div className={styles.filterTabs}>
            <button 
              className={filter === 'all' ? styles.activeTab : ''}
              onClick={() => setFilter('all')}
            >
              {t('filter_all')}
            </button>
            <button 
              className={filter === 'completed' ? styles.activeTab : ''}
              onClick={() => setFilter('completed')}
            >
              {t('filter_completed')}
            </button>
            <button 
              className={filter === 'failed' ? styles.activeTab : ''}
              onClick={() => setFilter('failed')}
            >
              {t('filter_failed')}
            </button>
            <button 
              className={filter === 'cancelled' ? styles.activeTab : ''}
              onClick={() => setFilter('cancelled')}
            >
              {t('filter_cancelled')}
            </button>
          </div>
        </div>
        
        {isLoadingHistory ? (
          <div className={styles.empty}>
            {t('loading_history')}
          </div>
        ) : displayedRecentJobs.length === 0 ? (
          <div className={styles.empty}>
            {t('history_empty')}
          </div>
        ) : (
          <div className={styles.recentList}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('col_type')}</th>
                  <th>ID</th>
                  <th>{t('col_status')}</th>
                  <th>{t('col_duration')}</th>
                  <th>{t('col_completed')}</th>
                  <th>{t('col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {displayedRecentJobs.map(job => (
                  <tr key={job.id} className={job.status.type === 'failed' ? styles.failedRow : job.status.type === 'cancelled' ? styles.cancelledRow : ''}>
                    <td>
                      <span className={styles.tableIcon}>{getJobTypeIcon(job.type)}</span>
                      {getJobTypeName(job.type)}
                    </td>
                    <td className={styles.mono}>#{job.id.slice(0, 8)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[job.status.type]}`}>
                        {job.status.type === 'completed' ? t('status_completed') : job.status.type === 'cancelled' ? t('status_cancelled') : t('status_failed')}
                      </span>
                    </td>
                    <td>{formatDuration(job.duration)}</td>
                    <td>{formatTimeAgo(job.completedAt)}</td>
                    <td>
                      {(() => {
                        const globalJob = globalActiveJobs.get(job.id);
                        const jobReport = globalJob?.report ?? job.report;
                        return (
                          <>
                            {jobReport && (
                              <button
                                className={styles.reportBtn}
                                onClick={() => setReportDialogData(jobReport)}
                              >
                                {t('show_report')}
                              </button>
                            )}
                            {job.status.type === 'failed' && (
                              <button
                                className={styles.retryBtn}
                                onClick={() => handleRetryJob(job.id, job.type)}
                                disabled={actionLoading === job.id}
                              >
                                {actionLoading === job.id ? '...' : t('retry')}
                              </button>
                            )}
                            {job.type === 'export' && job.status.type === 'completed' && (
                              <button
                                className={styles.downloadBtn}
                                onClick={() => handleDownloadExport(job.id)}
                                disabled={downloadingExportId === job.id}
                              >
                                {downloadingExportId === job.id ? t('downloading') : t('download_export')}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      


      {/* Import Report Dialog */}
      {reportDialogData && (
        <ImportReportDialog
          report={reportDialogData}
          onClose={() => setReportDialogData(null)}
        />
      )}
    </div>
  );
}
