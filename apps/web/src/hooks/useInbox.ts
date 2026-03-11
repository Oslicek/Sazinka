import { useState, useCallback, useEffect, useRef } from 'react';
import type { InboxItem, InboxRequest, InboxResponse } from '@shared/inbox';
import {
  getInbox,
  createPlannedAction,
  cancelPlannedAction,
  completePlannedAction,
  abandonCustomer,
  unabandonCustomer,
  type InboxServiceDeps,
} from '../services/inboxService';
import type { CreatePlannedActionRequest, PlannedAction } from '@shared/plannedAction';

export type { InboxItem, InboxRequest, InboxResponse };

export interface UseInboxOptions {
  initialRequest?: InboxRequest;
  deps?: InboxServiceDeps;
}

export interface UseInboxReturn {
  items: InboxItem[];
  total: number;
  overdueCount: number;
  dueSoonCount: number;
  isLoading: boolean;
  error: string | null;
  request: InboxRequest;
  setRequest: (req: InboxRequest) => void;
  refetch: () => void;
  createAction: (req: CreatePlannedActionRequest) => Promise<PlannedAction>;
  cancelAction: (actionId: string) => Promise<PlannedAction>;
  completeAction: (actionId: string) => Promise<PlannedAction>;
  abandon: (customerId: string) => Promise<void>;
  unabandon: (customerId: string) => Promise<void>;
}

const DEFAULT_REQUEST: InboxRequest = { limit: 25, offset: 0 };

export function useInbox(options: UseInboxOptions = {}): UseInboxReturn {
  const { initialRequest = DEFAULT_REQUEST, deps } = options;

  const [items, setItems] = useState<InboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueSoonCount, setDueSoonCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<InboxRequest>(initialRequest);

  // Track if component is still mounted to avoid state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchInbox = useCallback(async (req: InboxRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getInbox(req, deps);
      if (!mountedRef.current) return;
      setItems(response.items);
      setTotal(response.total);
      setOverdueCount(response.overdueCount);
      setDueSoonCount(response.dueSoonCount);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load inbox');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [deps]);

  useEffect(() => {
    fetchInbox(request);
  }, [request, fetchInbox]);

  const refetch = useCallback(() => {
    fetchInbox(request);
  }, [request, fetchInbox]);

  const createAction = useCallback(
    async (req: CreatePlannedActionRequest) => {
      const action = await createPlannedAction(req, deps);
      refetch();
      return action;
    },
    [deps, refetch]
  );

  const cancelAction = useCallback(
    async (actionId: string) => {
      const action = await cancelPlannedAction(actionId, deps);
      refetch();
      return action;
    },
    [deps, refetch]
  );

  const completeAction = useCallback(
    async (actionId: string) => {
      const action = await completePlannedAction(actionId, deps);
      refetch();
      return action;
    },
    [deps, refetch]
  );

  const abandon = useCallback(
    async (customerId: string) => {
      await abandonCustomer(customerId, deps);
      refetch();
    },
    [deps, refetch]
  );

  const unabandon = useCallback(
    async (customerId: string) => {
      await unabandonCustomer(customerId, deps);
      refetch();
    },
    [deps, refetch]
  );

  return {
    items,
    total,
    overdueCount,
    dueSoonCount,
    isLoading,
    error,
    request,
    setRequest,
    refetch,
    createAction,
    cancelAction,
    completeAction,
    abandon,
    unabandon,
  };
}
