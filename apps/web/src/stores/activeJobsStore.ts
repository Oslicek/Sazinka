/**
 * Global store for tracking active background jobs across the application
 */
import { create } from 'zustand';
import type { 
  CustomerImportJobStatusUpdate,
  GeocodeJobStatusUpdate,
} from '@shared/import';
import { useNatsStore } from './natsStore';

// Job types
export type JobType = 'import.customer' | 'geocode' | 'route';

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
      const unsubImport = await natsState.subscribe<CustomerImportJobStatusUpdate>(
        'sazinka.job.import.status.*',
        (update) => {
          handleImportJobStatusUpdate(update);
        }
      );
      unsubscribeFunctions.push(unsubImport);
      
      // Subscribe to geocoding job status updates
      const unsubGeocode = await natsState.subscribe<GeocodeJobStatusUpdate>(
        'sazinka.job.geocode.status.*',
        (update) => {
          handleGeocodeJobStatusUpdate(update);
        }
      );
      unsubscribeFunctions.push(unsubGeocode);
      
      set({ unsubscribeFunctions, isSubscribed: true });
    } catch (error) {
      console.error('Failed to start job subscriptions:', error);
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
 * Handle customer import job status updates
 */
function handleImportJobStatusUpdate(update: CustomerImportJobStatusUpdate) {
  const store = useActiveJobsStore.getState();
  const jobId = update.jobId;
  
  // Convert status to ActiveJob format
  const status = update.status;
  let jobStatus: ActiveJob['status'];
  let progress: number | undefined;
  let progressText: string | undefined;
  let error: string | undefined;
  let completedAt: Date | undefined;
  
  if (status.type === 'queued') {
    jobStatus = 'queued';
    progressText = `Pozice ve frontě: ${status.position}`;
  } else if (status.type === 'parsing') {
    jobStatus = 'processing';
    progress = status.progress;
    progressText = 'Parsování CSV...';
  } else if (status.type === 'importing') {
    jobStatus = 'processing';
    progress = Math.round((status.processed / status.total) * 100);
    progressText = `${status.processed}/${status.total} (${status.succeeded} úspěšně, ${status.failed} chyb)`;
  } else if (status.type === 'completed') {
    jobStatus = 'completed';
    progress = 100;
    progressText = `Dokončeno: ${status.succeeded}/${status.total} úspěšně`;
    completedAt = new Date();
  } else if (status.type === 'failed') {
    jobStatus = 'failed';
    error = status.error;
    progressText = 'Import selhal';
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
    // Create new job entry
    store.addJob({
      id: jobId,
      type: 'import.customer',
      name: 'Import zákazníků',
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
    progressText = `Pozice ve frontě: ${status.position}`;
  } else if (status.type === 'processing') {
    jobStatus = 'processing';
    progress = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
    progressText = `${status.processed}/${status.total} (${status.succeeded} OK, ${status.failed} chyb)`;
  } else if (status.type === 'completed') {
    jobStatus = 'completed';
    progress = 100;
    progressText = `Dokončeno: ${status.succeeded}/${status.total} úspěšně`;
    completedAt = new Date();
  } else if (status.type === 'failed') {
    jobStatus = 'failed';
    error = status.error;
    progressText = 'Geokódování selhalo';
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
      name: 'Geokódování',
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
