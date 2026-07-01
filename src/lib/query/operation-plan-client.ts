import { apiFetch } from '@/lib/api-fetch'
import {
  buildBillingActionQuotePreview,
  type BillingActionQuotePreview,
} from '@/lib/billing/action-quote-preview'
import type { OperationPlanView } from '@/lib/operations/planning'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function fetchOperationPlanView(params: {
  projectId: string
  operationId: string
  input: Record<string, unknown>
  context?: Record<string, unknown>
}): Promise<OperationPlanView> {
  const response = await apiFetch(`/api/projects/${params.projectId}/operations/${params.operationId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: params.input,
      ...(params.context ? { context: params.context } : {}),
    }),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}))
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : 'OPERATION_PLAN_FAILED'
    throw new Error(message)
  }
  return await response.json() as OperationPlanView
}

export async function fetchAssetOperationPlanView(params: {
  assetId: string
  action: 'generate'
  input: Record<string, unknown>
}): Promise<OperationPlanView> {
  const response = await apiFetch(`/api/assets/${params.assetId}/${params.action}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.input),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}))
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : 'OPERATION_PLAN_FAILED'
    throw new Error(message)
  }
  return await response.json() as OperationPlanView
}

export function readPlanConfirmedMaxCost(plan: OperationPlanView): number | null {
  const value = plan.quote.totalMaxFrozenCost
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function buildOperationPlanBillingText(params: {
  plan: OperationPlanView
  withCredits: (values: { count: number; cost: number }) => string
  withoutCredits: (values: { count: number }) => string
}): string | null {
  return buildOperationPlanBillingPreview(params)?.fullLabel ?? null
}

export function buildOperationPlanBillingPreview(params: {
  plan: OperationPlanView
  withCredits: (values: { count: number; cost: number }) => string
  withoutCredits: (values: { count: number }) => string
}): BillingActionQuotePreview | null {
  return buildBillingActionQuotePreview(params)
}
