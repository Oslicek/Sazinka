/**
 * Route Cache Store
 * 
 * Caches insertion calculation results to avoid redundant calculations.
 * Cache is invalidated when route changes (add/remove/reorder stops).
 */

import { create } from 'zustand';

interface InsertionResult {
  candidateId: string;
  bestDeltaKm: number;
  bestDeltaMin: number;
  bestInsertAfterIndex: number;
  status: 'ok' | 'tight' | 'conflict';
  isFeasible: boolean;
  calculatedAt: number; // timestamp
}

interface RouteCacheKey {
  date: string;
  vehicleId: string;
  routeVersion: number;
}

interface RouteCacheState {
  // Current route context
  currentKey: RouteCacheKey | null;
  
  // Cached insertion results by candidateId
  insertionCache: Map<string, InsertionResult>;
  
  // Route version (incremented on any route change)
  routeVersion: number;
  
  // Pending calculations
  pendingCalculations: Set<string>;
  
  // Actions
  setRouteContext: (date: string, vehicleId: string) => void;
  incrementRouteVersion: () => void;
  getCachedInsertion: (candidateId: string) => InsertionResult | null;
  setCachedInsertion: (result: InsertionResult) => void;
  setCachedInsertions: (results: InsertionResult[]) => void;
  invalidateCache: () => void;
  invalidateCandidateCache: (candidateId: string) => void;
  markPending: (candidateId: string) => void;
  unmarkPending: (candidateId: string) => void;
  isPending: (candidateId: string) => boolean;
  getCacheStats: () => { hits: number; misses: number; size: number };
}

// Cache expiry time in ms (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Track cache stats
let cacheHits = 0;
let cacheMisses = 0;

export const useRouteCacheStore = create<RouteCacheState>((set, get) => ({
  currentKey: null,
  insertionCache: new Map(),
  routeVersion: 0,
  pendingCalculations: new Set(),

  setRouteContext: (date, vehicleId) => {
    const current = get().currentKey;
    const routeVersion = get().routeVersion;
    
    // If context changed, invalidate cache
    if (current?.date !== date || current?.vehicleId !== vehicleId) {
      set({
        currentKey: { date, vehicleId, routeVersion },
        insertionCache: new Map(),
        pendingCalculations: new Set(),
      });
    }
  },

  incrementRouteVersion: () => {
    const newVersion = get().routeVersion + 1;
    const current = get().currentKey;
    
    set({
      routeVersion: newVersion,
      currentKey: current ? { ...current, routeVersion: newVersion } : null,
      // Clear cache on route change
      insertionCache: new Map(),
      pendingCalculations: new Set(),
    });
  },

  getCachedInsertion: (candidateId) => {
    const cache = get().insertionCache;
    const result = cache.get(candidateId);
    
    if (!result) {
      cacheMisses++;
      return null;
    }
    
    // Check if expired
    const now = Date.now();
    if (now - result.calculatedAt > CACHE_TTL_MS) {
      cache.delete(candidateId);
      cacheMisses++;
      return null;
    }
    
    cacheHits++;
    return result;
  },

  setCachedInsertion: (result) => {
    const cache = get().insertionCache;
    cache.set(result.candidateId, {
      ...result,
      calculatedAt: Date.now(),
    });
    set({ insertionCache: new Map(cache) });
  },

  setCachedInsertions: (results) => {
    const cache = get().insertionCache;
    const now = Date.now();
    
    for (const result of results) {
      cache.set(result.candidateId, {
        ...result,
        calculatedAt: now,
      });
    }
    
    set({ insertionCache: new Map(cache) });
  },

  invalidateCache: () => {
    set({
      insertionCache: new Map(),
      pendingCalculations: new Set(),
    });
    // Reset stats
    cacheHits = 0;
    cacheMisses = 0;
  },

  invalidateCandidateCache: (candidateId) => {
    const cache = get().insertionCache;
    cache.delete(candidateId);
    set({ insertionCache: new Map(cache) });
  },

  markPending: (candidateId) => {
    const pending = get().pendingCalculations;
    pending.add(candidateId);
    set({ pendingCalculations: new Set(pending) });
  },

  unmarkPending: (candidateId) => {
    const pending = get().pendingCalculations;
    pending.delete(candidateId);
    set({ pendingCalculations: new Set(pending) });
  },

  isPending: (candidateId) => {
    return get().pendingCalculations.has(candidateId);
  },

  getCacheStats: () => ({
    hits: cacheHits,
    misses: cacheMisses,
    size: get().insertionCache.size,
  }),
}));

/**
 * Hook to get cached insertion result or trigger calculation
 */
export function useCachedInsertion(
  candidateId: string,
  calculate: () => Promise<InsertionResult>
): InsertionResult | null {
  const {
    getCachedInsertion,
    setCachedInsertion,
    markPending,
    unmarkPending,
    isPending,
  } = useRouteCacheStore();

  // Check cache first
  const cached = getCachedInsertion(candidateId);
  if (cached) return cached;

  // If already pending, return null
  if (isPending(candidateId)) return null;

  // Trigger calculation
  markPending(candidateId);
  calculate()
    .then((result) => {
      setCachedInsertion(result);
    })
    .finally(() => {
      unmarkPending(candidateId);
    });

  return null;
}
