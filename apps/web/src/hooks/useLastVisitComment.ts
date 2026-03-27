import { useState, useEffect, useRef } from 'react';
import type { Visit } from '@shared/visit';
import type { VisitWorkItem } from '@shared/workItem';
import { listVisits, getVisit } from '@/services/visitService';
import { useNatsStore } from '@/stores/natsStore';
import { extractLastVisitComment } from '@/lib/lastVisitComment';

/** The data portion passed down to UI components (no loading state). */
export interface LastVisitCommentData {
  notes: string | null;
  visit: Visit | null;
}

export interface LastVisitCommentResult extends LastVisitCommentData {
  isLoading: boolean;
}

const EMPTY: LastVisitCommentResult = { notes: null, visit: null, isLoading: false };

/**
 * Per-customer in-memory cache. No TTL — entries live until page refresh.
 * If a new visit is completed while the planner is open, the stale cached
 * comment will remain until the user refreshes. This is an accepted v1
 * trade-off; a future iteration can add event-based invalidation or a TTL.
 */
const cache = new Map<string, LastVisitCommentResult>();

/** Clear the cache — for testing only. */
export function _clearLastVisitCommentCache(): void {
  cache.clear();
}

export function useLastVisitComment(customerId: string | null | undefined): LastVisitCommentResult {
  const isConnected = useNatsStore((s) => s.isConnected);

  const [result, setResult] = useState<LastVisitCommentResult>(() => {
    if (!customerId) return EMPTY;
    return cache.get(customerId) ?? { ...EMPTY, isLoading: true };
  });

  // Track the most recently requested customerId so stale responses can be ignored
  const latestCustomerIdRef = useRef<string | null | undefined>(customerId);

  useEffect(() => {
    latestCustomerIdRef.current = customerId;

    if (!customerId || !isConnected) {
      setResult(EMPTY);
      return;
    }

    const cached = cache.get(customerId);
    if (cached) {
      setResult(cached);
      return;
    }

    setResult({ notes: null, visit: null, isLoading: true });

    let cancelled = false;

    (async () => {
      try {
        const listResp = await listVisits({ customerId, status: 'completed', limit: 1 });
        if (cancelled || latestCustomerIdRef.current !== customerId) return;

        const visits = listResp.visits ?? [];
        if (visits.length === 0) {
          const r: LastVisitCommentResult = { notes: null, visit: null, isLoading: false };
          cache.set(customerId, r);
          if (!cancelled && latestCustomerIdRef.current === customerId) setResult(r);
          return;
        }

        const visitRow = visits[0] as Visit;

        try {
          const full = await getVisit(visitRow.id);
          if (cancelled || latestCustomerIdRef.current !== customerId) return;

          const notes = extractLastVisitComment(full.visit as Visit, full.workItems as VisitWorkItem[]);
          const r: LastVisitCommentResult = { notes, visit: full.visit as Visit, isLoading: false };
          cache.set(customerId, r);
          if (!cancelled && latestCustomerIdRef.current === customerId) setResult(r);
        } catch {
          // getVisit failed — fall back to visit-level notes from listVisits row
          if (cancelled || latestCustomerIdRef.current !== customerId) return;
          const notes = visitRow.resultNotes?.trim() || null;
          const r: LastVisitCommentResult = { notes, visit: visitRow, isLoading: false };
          cache.set(customerId, r);
          if (!cancelled && latestCustomerIdRef.current === customerId) setResult(r);
        }
      } catch {
        if (cancelled || latestCustomerIdRef.current !== customerId) return;
        const r: LastVisitCommentResult = { notes: null, visit: null, isLoading: false };
        cache.set(customerId, r);
        if (!cancelled && latestCustomerIdRef.current === customerId) setResult(r);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, isConnected]);

  return result;
}
