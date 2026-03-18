import type {
  ScoringRuleSet,
  ScoringRuleFactor,
  FactorInput,
  CreateScoringRuleSetRequest,
  UpdateScoringRuleSetRequest,
  DispatcherInboxState,
  SaveInboxStateRequest,
} from '@shared/scoring';
import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

export type {
  ScoringRuleSet,
  ScoringRuleFactor,
  FactorInput,
  CreateScoringRuleSetRequest,
  UpdateScoringRuleSetRequest,
  DispatcherInboxState,
  SaveInboxStateRequest,
};

interface ServiceDeps {
  request: <TReq, TRes>(subject: string, payload: TReq) => Promise<TRes>;
}

function getDefaultDeps(): ServiceDeps {
  return { request: useNatsStore.getState().request };
}

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(r: NatsResponse<unknown>): r is ErrorResponse {
  return 'error' in r;
}

// ============================================================================
// Rule sets
// ============================================================================

export async function listRuleSets(
  includeArchived = false,
  deps: ServiceDeps = getDefaultDeps()
): Promise<ScoringRuleSet[]> {
  const request = createRequest(getToken(), includeArchived);
  const response = await deps.request<typeof request, NatsResponse<ScoringRuleSet[]>>(
    'sazinka.scoring.rule_set.list',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

export async function createRuleSet(
  req: CreateScoringRuleSetRequest,
  deps: ServiceDeps = getDefaultDeps()
): Promise<ScoringRuleSet> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<ScoringRuleSet>>(
    'sazinka.scoring.rule_set.create',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

export async function updateRuleSet(
  req: UpdateScoringRuleSetRequest,
  deps: ServiceDeps = getDefaultDeps()
): Promise<ScoringRuleSet> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<ScoringRuleSet>>(
    'sazinka.scoring.rule_set.update',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

export async function archiveRuleSet(
  ruleSetId: string,
  deps: ServiceDeps = getDefaultDeps()
): Promise<void> {
  const request = createRequest(getToken(), ruleSetId);
  const response = await deps.request<typeof request, NatsResponse<unknown>>(
    'sazinka.scoring.rule_set.archive',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
}

export async function setDefaultRuleSet(
  ruleSetId: string,
  deps: ServiceDeps = getDefaultDeps()
): Promise<void> {
  const request = createRequest(getToken(), ruleSetId);
  const response = await deps.request<typeof request, NatsResponse<unknown>>(
    'sazinka.scoring.rule_set.set_default',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
}

export async function deleteRuleSet(
  ruleSetId: string,
  deps: ServiceDeps = getDefaultDeps()
): Promise<void> {
  const request = createRequest(getToken(), ruleSetId);
  const response = await deps.request<typeof request, NatsResponse<unknown>>(
    'sazinka.scoring.rule_set.delete',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
}

export async function restoreRuleSetDefaults(
  ruleSetId: string,
  deps: ServiceDeps = getDefaultDeps()
): Promise<ScoringRuleSet> {
  const request = createRequest(getToken(), ruleSetId);
  const response = await deps.request<typeof request, NatsResponse<ScoringRuleSet>>(
    'sazinka.scoring.rule_set.restore_defaults',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

// ============================================================================
// Inbox state
// ============================================================================

export async function getInboxState(
  deps: ServiceDeps = getDefaultDeps()
): Promise<DispatcherInboxState | null> {
  const request = createRequest(getToken(), null);
  const response = await deps.request<typeof request, NatsResponse<DispatcherInboxState | null>>(
    'sazinka.inbox_state.get',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}

export async function saveInboxState(
  req: SaveInboxStateRequest,
  deps: ServiceDeps = getDefaultDeps()
): Promise<DispatcherInboxState> {
  const request = createRequest(getToken(), req);
  const response = await deps.request<typeof request, NatsResponse<DispatcherInboxState>>(
    'sazinka.inbox_state.save',
    request
  );
  if (isErrorResponse(response)) throw new Error(response.error.message);
  return response.payload;
}
