/**
 * Global store for tracking active background jobs across the application
 */
import { create } from 'zustand';
import type { 
  CustomerImportJobStatusUpdate,
  DeviceImportJobStatusUpdate,
  RevisionImportJobStatusUpdate,
  CommunicationImportJobStatusUpdate,
  WorkLogImportJobStatusUpdate,
  ZipImportJobStatusUpdate,
  GeocodeJobStatusUpdate,
  ImportReport,
} from '@shared/import';
import { useNatsStore } from './natsStore';
import { logger } from '../utils/logger';
import i18n from '@/i18n';

// Job types - all import types plus other background jobs
export type JobType = 
  | 'import.customer' 
  | 'import.device'
  | 'import.revision'
  | 'import.communication'
  | 'import.work_log'
  | 'import.zip'
  | 'geocode' 
  | 'route'
  | 'export';

// i18n keys for job type names
const JOB_TYPE_KEYS: Record<JobType, string> = {
  'import.customer': 'jobs:type_import_customer',
  'import.device': 'jobs:type_import_device',
  'import.revision': 'jobs:type_import_revision',
  'import.communication': 'jobs:type_import_communication',
  'import.work_log': 'jobs:type_import_work_log',
  'import.zip': 'jobs:type_import_zip',
  'geocode': 'jobs:type_geocode',
  'route': 'jobs:type_route',
  'export': 'jobs:type_export',
};

/** Get translated job type name */
export function getJobTypeName(type: JobType): string {
  return i18n.t(JOB_TYPE_KEYS[type]);
}

interface ExportJobStatusUpdate {
  jobId: string;
  timestamp: string;
  status:
    | { type: 'queued'; position?: number }
    | { type: 'processing'; progress?: number; message?: string }
    | { type: 'completed'; result?: { fileName?: string } }
    | { type: 'failed'; error: string };
}

// Active job info
export interface ActiveJob {
  id: string;
  type: JobType;
  name: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  progressText?: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  /** Structured import report, available when job completes */
  report?: ImportReport;
}

interface ActiveJobsState {
  // Map of jobId -> job info
  jobs: Map<string, ActiveJob>;
  
  // Computed count of active (non-completed) jobs
  activeCount: number;
  
  // Subscriptions cleanup functions
  unsubscribeFunctions: (() => void)[];
  isSubscribed: boolean;
  
  // Actions
  addJob: (job: ActiveJob) => void;
  updateJob: (jobId: string, updates: Partial<ActiveJob>) => void;
  removeJob: (jobId: string) => void;
  clearCompletedJobs: () => void;
  
  // Subscription management
  startSubscriptions: () => Promise<void>;
  stopSubscriptions: () => void;
  
  // Get jobs by type
  getJobsByType: (type: JobType) => ActiveJob[];
  getActiveJobs: () => ActiveJob[];
}

function countActiveJobs(jobs: Map<string, ActiveJob>): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'processing') {
      count++;
    }
  }
  return count;
}

export const useActiveJobsStore = create<ActiveJobsState>((set, get) => ({
  jobs: new Map(),
  activeCount: 0,
  unsubscribeFunctions: [],
  isSubscribed: false,

  addJob: (job: ActiveJob) => {
    set((state) => {
      const newJobs = new Map(state.jobs);
      newJobs.set(job.id, job);
      return {
        jobs: newJobs,
        activeCount: countActiveJobs(newJobs),
      };
    });
  },

  updateJob: (jobId: string, updates: Partial<ActiveJob>) => {
    set((state) => {
      const job = state.jobs.get(jobId);
      if (!job) return state;
      
      const newJobs = new Map(state.jobs);
      newJobs.set(jobId, { ...job, ...updates });
      return {
        jobs: newJobs,
        activeCount: countActiveJobs(newJobs),
      };
    });
  },

  removeJob: (jobId: string) => {
    set((state) => {
      const newJobs = new Map(state.jobs);
      newJobs.delete(jobId);
      return {
        jobs: newJobs,
        activeCount: countActiveJobs(newJobs),
      };
    });
  },

  clearCompletedJobs: () => {
    set((state) => {
      const newJobs = new Map<string, ActiveJob>();
      for (const [id, job] of state.jobs) {
        if (job.status === 'queued' || job.status === 'processing') {
          newJobs.set(id, job);
        }
      }
      return {
        jobs: newJobs,
        activeCount: countActiveJobs(newJobs),
      };
    });
  },

  startSubscriptions: async () => {
    const state = get();
    if (state.isSubscribed) return;
    
    const natsState = useNatsStore.getState();
    if (typeof natsState.subscribe !== 'function' || !natsState.isConnected) {
      // Retry when connected
      const checkConnection = setInterval(() => {
        const ns = useNatsStore.getState();
        if (ns.isConnected && typeof ns.subscribe === 'function') {
          clearInterval(checkConnection);
          get().startSubscriptions();
        }
      }, 1000);
      return;
    }
    
    const unsubscribeFunctions: (() => void)[] = [];
    
    try {
      // Subscribe to customer import job status updates
      const unsubCustomerImport = await natsState.subscribe<CustomerImportJobStatusUpdate>(
        'sazinka.job.import.customer.status.*',
        (update) => handleImportJobStatusUpdate(update, 'import.customer')
      );
      unsubscribeFunctions.push(unsubCustomerImport);
      
      // Subscribe to device import job status updates
      const unsubDeviceImport = await natsState.subscribe<DeviceImportJobStatusUpdate>(
        'sazinka.job.import.device.status.*',
        (update) => handleImportJobStatusUpdate(update, 'import.device')
      );
      unsubscribeFunctions.push(unsubDeviceImport);
      
      // Subscribe to revision import job status updates
      const unsubRevisionImport = await natsState.subscribe<RevisionImportJobStatusUpdate>(
        'sazinka.job.import.revision.status.*',
        (update) => handleImportJobStatusUpdate(update, 'import.revision')
      );
      unsubscribeFunctions.push(unsubRevisionImport);
      
      // Subscribe to communication import job status updates
      const unsubCommunicationImport = await natsState.subscribe<CommunicationImportJobStatusUpdate>(
        'sazinka.job.import.communication.status.*',
        (update) => handleImportJobStatusUpdate(update, 'import.communication')
      );
      unsubscribeFunctions.push(unsubCommunicationImport);
      
      // Subscribe to work log import job status updates
      const unsubWorkLogImport = await natsState.subscribe<WorkLogImportJobStatusUpdate>(
        'sazinka.job.import.worklog.status.*',
        (update) => handleImportJobStatusUpdate(update, 'import.work_log')
      );
      unsubscribeFunctions.push(unsubWorkLogImport);
      
      // Subscribe to ZIP import job status updates
      const unsubZipImport = await natsState.subscribe<ZipImportJobStatusUpdate>(
        'sazinka.job.import.zip.status.*',
        (update) => handleZipImportJobStatusUpdate(update)
      );
      unsubscribeFunctions.push(unsubZipImport);
      
      // Subscribe to geocoding job status updates
      const unsubGeocode = await natsState.subscribe<GeocodeJobStatusUpdate>(
        'sazinka.job.geocode.status.*',
        (update) => handleGeocodeJobStatusUpdate(update)
      );
      unsubscribeFunctions.push(unsubGeocode);

      // Subscribe to export job status updates
      const unsubExport = await natsState.subscribe<ExportJobStatusUpdate>(
        'sazinka.job.export.status.*',
        (update) => handleExportJobStatusUpdate(update)
      );
      unsubscribeFunctions.push(unsubExport);
      
      set({ unsubscribeFunctions, isSubscribed: true });
    } catch (error) {
      logger.error('Failed to start job subscriptions:', error);
    }
  },

  stopSubscriptions: () => {
    const { unsubscribeFunctions } = get();
    for (const unsub of unsubscribeFunctions) {
      unsub();
    }
    set({ unsubscribeFunctions: [], isSubscribed: false });
  },

  getJobsByType: (type: JobType) => {
    const jobs: ActiveJob[] = [];
    for (const job of get().jobs.values()) {
      if (job.type === type) {
        jobs.push(job);
      }
    }
    return jobs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  },

  getActiveJobs: () => {
    const jobs: ActiveJob[] = [];
    for (const job of get().jobs.values()) {
      if (job.status === 'queued' || job.status === 'processing') {
        jobs.push(job);
      }
    }
    return jobs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  },
}));

/**
 * Generic import job status update type
 */
type GenericImportJobStatusUpdate = CustomerImportJobStatusUpdate | DeviceImportJobStatusUpdate | RevisionImportJobStatusUpdate | CommunicationImportJobStatusUpdate | WorkLogImportJobStatusUpdate;

/**
 * Handle import job status updates for all standard import types
 * (customer, device, revision, communication, visit)
 */
function handleImportJobStatusUpdate(update: GenericImportJobStatusUpdate, jobType: JobType) {
  const store = useActiveJobsStore.getState();
  const jobId = update.jobId;
  
  // Convert status to ActiveJob format
  const status = update.status;
  let jobStatus: ActiveJob['status'];
  let progress: number | undefined;
  let progressText: string | undefined;
  let error: string | undefined;
  let completedAt: Date | undefined;
  let report: ImportReport | undefined;
  
  if (status.type === 'queued') {
    jobStatus = 'queued';
    progressText = i18n.t('jobs:queue_position', { position: status.position });
  } else if (status.type === 'parsing') {
    jobStatus = 'processing';
    progress = status.progress;
    progressText = i18n.t('jobs:parsing_csv');
  } else if (status.type === 'importing') {
    jobStatus = 'processing';
    progress = Math.round((status.processed / status.total) * 100);
    progressText = i18n.t('jobs:progress_importing', { processed: status.processed, total: status.total, succeeded: status.succeeded, failed: status.failed });
  } else if (status.type === 'completed') {
    jobStatus = 'completed';
    progress = 100;
    progressText = i18n.t('jobs:progress_completed', { succeeded: status.succeeded, total: status.total });
    if (status.failed > 0) {
      progressText += ` ${i18n.t('jobs:progress_errors', { failed: status.failed })}`;
    }
    completedAt = new Date();
    report = status.report;
  } else if (status.type === 'failed') {
    jobStatus = 'failed';
    error = status.error;
    progressText = i18n.t('jobs:import_failed');
    completedAt = new Date();
  } else {
    return;
  }
  
  const existingJob = store.jobs.get(jobId);
  
  if (existingJob) {
    store.updateJob(jobId, {
      status: jobStatus,
      progress,
      progressText,
      error,
      completedAt,
      report,
    });
  } else {
    // Create new job entry
    store.addJob({
      id: jobId,
      type: jobType,
      name: getJobTypeName(jobType),
      status: jobStatus,
      progress,
      progressText,
      startedAt: new Date(update.timestamp),
      completedAt,
      error,
      report,
    });
  }
}

/**
 * Handle ZIP import job status updates (has different status structure)
 */
function handleZipImportJobStatusUpdate(update: ZipImportJobStatusUpdate) {
  const store = useActiveJobsStore.getState();
  const jobId = update.jobId;
  
  const status = update.status;
  let jobStatus: ActiveJob['status'];
  let progress: number | undefined;
  let progressText: string | undefined;
  let error: string | undefined;
  let completedAt: Date | undefined;
  let report: ImportReport | undefined;
  
  if (status.type === 'queued') {
    jobStatus = 'queued';
    progressText = i18n.t('jobs:queue_position', { position: status.position });
  } else if (status.type === 'extracting') {
    jobStatus = 'processing';
    progress = status.progress;
    progressText = i18n.t('jobs:extracting_zip');
  } else if (status.type === 'analyzing') {
    jobStatus = 'processing';
    progress = 10;
    progressText = i18n.t('jobs:found_files', { count: status.files.length });
  } else if (status.type === 'importing') {
    jobStatus = 'processing';
    const baseProgress = (status.completedFiles / status.totalFiles) * 100;
    const fileContribution = (status.fileProgress / 100) * (100 / status.totalFiles);
    progress = Math.round(baseProgress + fileContribution);
    progressText = `${status.currentFile} (${status.completedFiles + 1}/${status.totalFiles})`;
  } else if (status.type === 'completed') {
    jobStatus = 'completed';
    progress = 100;
    const totalSucceeded = status.results.reduce((sum, r) => sum + r.succeeded, 0);
    const totalFailed = status.results.reduce((sum, r) => sum + r.failed, 0);
    progressText = i18n.t('jobs:zip_completed', { totalFiles: status.totalFiles, succeeded: totalSucceeded, failed: totalFailed });
    completedAt = new Date();
    // Merge all file reports into a combined report
    const allIssues = status.results.flatMap(r => r.report?.issues ?? []);
    report = {
      jobId,
      jobType: 'import.zip',
      filename: status.results.map(r => r.filename).join(', '),
      importedAt: new Date().toISOString(),
      durationMs: 0,
      totalRows: totalSucceeded + totalFailed,
      importedCount: totalSucceeded,
      updatedCount: 0,
      skippedCount: 0,
      issues: allIssues,
    };
  } else if (status.type === 'failed') {
    jobStatus = 'failed';
    error = status.error;
    progressText = i18n.t('jobs:zip_import_failed');
    completedAt = new Date();
  } else {
    return;
  }
  
  const existingJob = store.jobs.get(jobId);
  
  if (existingJob) {
    store.updateJob(jobId, {
      status: jobStatus,
      progress,
      progressText,
      error,
      completedAt,
      report,
    });
  } else {
    store.addJob({
      id: jobId,
      type: 'import.zip',
      name: getJobTypeName('import.zip'),
      status: jobStatus,
      progress,
      progressText,
      startedAt: new Date(update.timestamp),
      completedAt,
      error,
      report,
    });
  }
}

/**
 * Handle geocoding job status updates
 */
function handleGeocodeJobStatusUpdate(update: GeocodeJobStatusUpdate) {
  const store = useActiveJobsStore.getState();
  const jobId = update.jobId;
  
  const status = update.status;
  let jobStatus: ActiveJob['status'];
  let progress: number | undefined;
  let progressText: string | undefined;
  let error: string | undefined;
  let completedAt: Date | undefined;
  
  if (status.type === 'queued') {
    jobStatus = 'queued';
    progressText = i18n.t('jobs:queue_position', { position: status.position });
  } else if (status.type === 'processing') {
    jobStatus = 'processing';
    progress = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
    progressText = i18n.t('jobs:geocode_progress', { processed: status.processed, total: status.total, succeeded: status.succeeded, failed: status.failed });
  } else if (status.type === 'completed') {
    jobStatus = 'completed';
    progress = 100;
    progressText = i18n.t('jobs:geocode_completed', { succeeded: status.succeeded, total: status.total });
    completedAt = new Date();
  } else if (status.type === 'failed') {
    jobStatus = 'failed';
    error = status.error;
    progressText = i18n.t('jobs:geocode_failed');
    completedAt = new Date();
  } else {
    return;
  }
  
  const existingJob = store.jobs.get(jobId);
  
  if (existingJob) {
    store.updateJob(jobId, {
      status: jobStatus,
      progress,
      progressText,
      error,
      completedAt,
    });
  } else {
    store.addJob({
      id: jobId,
      type: 'geocode',
      name: getJobTypeName('geocode'),
      status: jobStatus,
      progress,
      progressText,
      startedAt: new Date(update.timestamp),
      completedAt,
      error,
    });
  }
}

/**
 * Handle export job status updates
 */
function handleExportJobStatusUpdate(update: ExportJobStatusUpdate) {
  const store = useActiveJobsStore.getState();
  const jobId = update.jobId;
  const status = update.status;

  let jobStatus: ActiveJob['status'];
  let progress: number | undefined;
  let progressText: string | undefined;
  let error: string | undefined;
  let completedAt: Date | undefined;

  if (status.type === 'queued') {
    jobStatus = 'queued';
    progressText = status.position ? i18n.t('jobs:queue_position', { position: status.position }) : i18n.t('jobs:queue_waiting');
  } else if (status.type === 'processing') {
    jobStatus = 'processing';
    progress = status.progress;
    progressText = status.message || i18n.t('jobs:export_running');
  } else if (status.type === 'completed') {
    jobStatus = 'completed';
    progress = 100;
    const fileName = status.result?.fileName;
    progressText = fileName ? i18n.t('jobs:export_completed_file', { fileName }) : i18n.t('jobs:export_completed');
    completedAt = new Date();
  } else if (status.type === 'failed') {
    jobStatus = 'failed';
    error = status.error;
    progressText = i18n.t('jobs:export_failed');
    completedAt = new Date();
  } else {
    return;
  }

  const existingJob = store.jobs.get(jobId);

  if (existingJob) {
    store.updateJob(jobId, {
      status: jobStatus,
      progress,
      progressText,
      error,
      completedAt,
    });
  } else {
    store.addJob({
      id: jobId,
      type: 'export',
      name: getJobTypeName('export'),
      status: jobStatus,
      progress,
      progressText,
      startedAt: new Date(update.timestamp),
      completedAt,
      error,
    });
  }
}

// Auto-start subscriptions when NATS is connected
if (typeof window !== 'undefined') {
  // Check periodically if NATS is connected and start subscriptions
  const startActiveJobsSubscriptions = () => {
    const natsState = useNatsStore.getState();
    const jobsState = useActiveJobsStore.getState();
    
    if (natsState.isConnected && !jobsState.isSubscribed) {
      jobsState.startSubscriptions();
    }
  };
  
  // Initial check
  setTimeout(startActiveJobsSubscriptions, 500);
  
  // Subscribe to NATS connection changes
  useNatsStore.subscribe((state, prevState) => {
    if (state.isConnected && !prevState.isConnected) {
      setTimeout(startActiveJobsSubscriptions, 100);
    }
  });
}
