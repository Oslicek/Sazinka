/**
 * Work Item service for managing visit work items
 */

import type {
  VisitWorkItem,
  CreateWorkItemRequest,
  CompleteWorkItemRequest,
  ListWorkItemsRequest,
  ListWorkItemsResponse,
  WorkType,
  WorkResult,
} from '@shared/workItem';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';
import i18n from '@/i18n';

export interface WorkItemServiceDeps {
  request: <TRes>(subject: string, payload: unknown) => Promise<TRes>;
}

function getDefaultDeps(): WorkItemServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

/**
 * Get a single work item by ID
 */
export async function getWorkItem(
  id: string,
  deps = getDefaultDeps()
): Promise<VisitWorkItem> {
  const request = createRequest(getToken(), { id });
  const response = await deps.request<{ payload: VisitWorkItem }>(
    'sazinka.work_item.get',
    request
  );
  return response.payload;
}

/**
 * List work items with filters
 */
export async function listWorkItems(
  filters: ListWorkItemsRequest,
  deps = getDefaultDeps()
): Promise<ListWorkItemsResponse> {
  const request = createRequest(getToken(), filters);
  const response = await deps.request<{ payload: ListWorkItemsResponse }>(
    'sazinka.work_item.list',
    request
  );
  return response.payload;
}

/**
 * List work items for a specific visit
 */
export async function listWorkItemsForVisit(
  visitId: string,
  deps = getDefaultDeps()
): Promise<VisitWorkItem[]> {
  const response = await listWorkItems({ visitId }, deps);
  return response.items;
}

/**
 * Create a new work item
 */
export async function createWorkItem(
  data: CreateWorkItemRequest,
  deps = getDefaultDeps()
): Promise<VisitWorkItem> {
  const request = createRequest(getToken(), data);
  const response = await deps.request<{ payload: VisitWorkItem }>(
    'sazinka.work_item.create',
    request
  );
  return response.payload;
}

/**
 * Complete a work item
 */
export async function completeWorkItem(
  data: CompleteWorkItemRequest,
  deps = getDefaultDeps()
): Promise<VisitWorkItem> {
  const request = createRequest(getToken(), data);
  const response = await deps.request<{ payload: VisitWorkItem }>(
    'sazinka.work_item.complete',
    request
  );
  return response.payload;
}

/**
 * Get work type label
 */
export function getWorkTypeLabel(type: WorkType): string {
  const key = `common:work_type.${type}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : type;
}

/**
 * Get work result label
 */
export function getWorkResultLabel(result: WorkResult): string {
  const key = `common:work_result.${result}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : result;
}

