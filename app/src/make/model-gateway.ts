import type {
  AppGenerateRequest,
  AppGenerateResult,
  AppPlan,
  AppPlanApprovalResult,
  AppPlanRequest,
  AppPlanResponse,
  ModelBudget,
  ModelRequest,
  ModelResponse,
  ModelTurnRecord,
} from './types.ts'
import { api } from '../cloud/api.ts'
import { MODEL_GATEWAY_LIMITS } from './model-protocol.ts'
import { validateAppPlan } from './plan.ts'
export { MODEL_GATEWAY_LIMITS, redactSensitiveText, redactSensitiveObject } from './model-protocol.ts'

interface ModelRequestOptions { signal?: AbortSignal; accountId?: string }

export async function requestModelGeneration(
  request: ModelRequest,
  options?: ModelRequestOptions
): Promise<ModelResponse> {
  const path = request.appId
    ? `/apps/${encodeURIComponent(request.appId)}/generate`
    : '/model/generate'

  return api<ModelResponse>(path, {
    method: 'POST',
    body: JSON.stringify(request),
    signal: options?.signal,
    headers: options?.accountId ? { 'X-Paper-Account': options.accountId } : undefined,
    timeoutMs: MODEL_GATEWAY_LIMITS.DEFAULT_TIMEOUT_MS + 5_000,
  })
}

export async function fetchModelBudget(
  appId?: string,
  options?: ModelRequestOptions
): Promise<ModelBudget> {
  const path = appId
    ? `/apps/${encodeURIComponent(appId)}/budget`
    : '/model/budget'

  const res = await api<{ budget: ModelBudget }>(path, {
    method: 'GET',
    signal: options?.signal,
    headers: options?.accountId ? { 'X-Paper-Account': options.accountId } : undefined,
  })
  return res.budget
}

export async function fetchModelTurns(
  appId?: string,
  options?: ModelRequestOptions
): Promise<ModelTurnRecord[]> {
  const path = appId
    ? `/apps/${encodeURIComponent(appId)}/turns`
    : '/model/turns'

  const res = await api<{ turns: ModelTurnRecord[] }>(path, {
    method: 'GET',
    signal: options?.signal,
    headers: options?.accountId ? { 'X-Paper-Account': options.accountId } : undefined,
  })
  return res.turns
}

export async function requestModelPlan(
  request: AppPlanRequest,
  options?: ModelRequestOptions
): Promise<AppPlanResponse> {
  const path = request.appId
    ? `/apps/${encodeURIComponent(request.appId)}/plan`
    : '/model/plan'

  const res = await api<AppPlanResponse>(path, {
    method: 'POST',
    body: JSON.stringify(request),
    signal: options?.signal,
    headers: options?.accountId ? { 'X-Paper-Account': options.accountId } : undefined,
    timeoutMs: MODEL_GATEWAY_LIMITS.DEFAULT_TIMEOUT_MS + 5_000,
  })

  return {
    ...res,
    plan: validateAppPlan(res.plan),
  }
}

export async function approveModelPlan(
  appId: string,
  plan: AppPlan,
  options?: ModelRequestOptions
): Promise<AppPlanApprovalResult> {
  const path = `/apps/${encodeURIComponent(appId)}/plan/approve`

  const res = await api<AppPlanApprovalResult>(path, {
    method: 'POST',
    body: JSON.stringify({ plan, expectedRevision: plan.baseRevision }),
    signal: options?.signal,
    headers: options?.accountId ? { 'X-Paper-Account': options.accountId } : undefined,
    timeoutMs: 15_000,
  })

  return {
    ok: res.ok,
    plan: validateAppPlan(res.plan),
    approvedAt: res.approvedAt,
  }
}

export async function requestAppGeneration(
  request: AppGenerateRequest,
  options?: ModelRequestOptions
): Promise<AppGenerateResult> {
  const path = request.appId
    ? `/apps/${encodeURIComponent(request.appId)}/generate`
    : '/model/generate'

  const res = await api<AppGenerateResult>(path, {
    method: 'POST',
    body: JSON.stringify(request),
    signal: options?.signal,
    headers: options?.accountId ? { 'X-Paper-Account': options.accountId } : undefined,
    // Two bounded provider turns and two browser checks, plus transport time.
    timeoutMs: 2 * MODEL_GATEWAY_LIMITS.DEFAULT_TIMEOUT_MS + 40_000,
  })

  return {
    ...res,
    plan: validateAppPlan(res.plan),
  }
}
