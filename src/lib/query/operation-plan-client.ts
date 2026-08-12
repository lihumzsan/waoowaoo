import { apiFetch } from '@/lib/api-fetch'
import {
  buildBillingActionQuotePreview,
  type BillingActionQuotePreview,
} from '@/lib/billing/action-quote-preview'
import type { OperationPlanView } from '@/lib/operations/plan-contract'
import { readClientApiError } from '@/lib/errors/client'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'

export async function fetchOperationPlanView(params: {
  projectId: string
  operationId: string
  input: Record<string, unknown>
  context?: Record<string, unknown>
  operationRequestId?: string
}): Promise<OperationPlanView> {
  const operationRequestId = params.operationRequestId ?? crypto.randomUUID()
  const response = await apiFetch(`/api/projects/${params.projectId}/operations/${params.operationId}/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': operationRequestId,
    },
    body: JSON.stringify({
      input: params.input,
      ...(params.context ? { context: params.context } : {}),
    }),
  })
  if (!response.ok) {
    throw await readClientApiError(response)
  }
  const plan = await response.json() as OperationPlanView
  if (plan.operationRequestId !== operationRequestId) {
    throw new Error('OPERATION_PLAN_REQUEST_ID_DIVERGED')
  }
  return plan
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
    throw await readClientApiError(response)
  }
  return await response.json() as OperationPlanView
}

export async function fetchAssetHubOperationPlanView(params: {
  operationId: string
  input: Record<string, unknown>
}): Promise<OperationPlanView> {
  const response = await apiFetch(`/api/asset-hub/operations/${params.operationId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: params.input }),
  })
  if (!response.ok) {
    throw await readClientApiError(response)
  }
  return await response.json() as OperationPlanView
}

export async function issueOperationApprovalGrant(
  plan: OperationPlanView,
  requestedOperationRequestId?: string,
): Promise<{
  approvalGrantId: string
  operationRequestId: string
}> {
  if (!plan.planSnapshotId) throw new Error('OPERATION_PLAN_SNAPSHOT_ID_REQUIRED')
  const operationRequestId = requestedOperationRequestId
    ?? plan.operationRequestId
    ?? crypto.randomUUID()
  if (plan.operationRequestId && plan.operationRequestId !== operationRequestId) {
    throw new Error('OPERATION_PLAN_REQUEST_ID_DIVERGED')
  }
  const response = await apiFetch('/api/operation-approval-grants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': operationRequestId,
    },
    body: JSON.stringify({
      planSnapshotId: plan.planSnapshotId,
      operationRequestId,
    }),
  })
  if (!response.ok) {
    throw await readClientApiError(response)
  }
  const payload = await response.json() as unknown
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('OPERATION_APPROVAL_GRANT_RESPONSE_INVALID')
  }
  const record = payload as Record<string, unknown>
  if (
    typeof record.approvalGrantId !== 'string'
    || !record.approvalGrantId
    || record.operationRequestId !== operationRequestId
  ) {
    throw new Error('OPERATION_APPROVAL_GRANT_RESPONSE_DIVERGED')
  }
  return {
    approvalGrantId: record.approvalGrantId,
    operationRequestId,
  }
}

interface ExecuteCanvasOperationParams {
  readonly projectId: string
  readonly operationId: string
  readonly input: Readonly<Record<string, unknown>>
  readonly context?: Readonly<Record<string, unknown>>
  readonly operationRequestId: string
}

export async function executeApprovedCanvasOperation(
  params: ExecuteCanvasOperationParams & { readonly approvalGrantId: string },
): Promise<unknown> {
  return await requestJsonWithError<unknown>(
    `/api/projects/${encodeURIComponent(params.projectId)}/operations/${encodeURIComponent(params.operationId)}/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': params.operationRequestId,
      },
      body: JSON.stringify({
        input: params.input,
        context: params.context ?? {},
        approvalGrantId: params.approvalGrantId,
        operationRequestId: params.operationRequestId,
      }),
    },
  )
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
