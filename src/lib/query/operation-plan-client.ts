'use client'

import { apiFetch } from '@/lib/api-fetch'
import type { OperationPlanView } from '@/lib/operations/planning'
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
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationRequestId },
    body: JSON.stringify({ input: params.input, ...(params.context ? { context: params.context } : {}) }),
  })
  if (!response.ok) throw await readClientApiError(response)
  const plan = await response.json() as OperationPlanView
  if (plan.operationRequestId !== operationRequestId) throw new Error('OPERATION_PLAN_REQUEST_ID_DIVERGED')
  return plan
}

export async function fetchAssetOperationPlanView(params: {
  assetId: string
  action: 'generate'
  input: Record<string, unknown>
}): Promise<OperationPlanView> {
  const response = await apiFetch(`/api/assets/${params.assetId}/${params.action}/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params.input),
  })
  if (!response.ok) throw await readClientApiError(response)
  return await response.json() as OperationPlanView
}

export async function issueOperationApprovalGrant(plan: OperationPlanView, requestedOperationRequestId?: string) {
  if (!plan.planSnapshotId) throw new Error('OPERATION_PLAN_SNAPSHOT_ID_REQUIRED')
  const operationRequestId = requestedOperationRequestId ?? plan.operationRequestId ?? crypto.randomUUID()
  if (plan.operationRequestId && plan.operationRequestId !== operationRequestId) throw new Error('OPERATION_PLAN_REQUEST_ID_DIVERGED')
  const response = await apiFetch('/api/operation-approval-grants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationRequestId },
    body: JSON.stringify({ planSnapshotId: plan.planSnapshotId, operationRequestId }),
  })
  if (!response.ok) throw await readClientApiError(response)
  const record = await response.json() as Record<string, unknown>
  if (typeof record.approvalGrantId !== 'string' || record.operationRequestId !== operationRequestId) {
    throw new Error('OPERATION_APPROVAL_GRANT_RESPONSE_DIVERGED')
  }
  return { approvalGrantId: record.approvalGrantId, operationRequestId }
}

export async function executeApprovedCanvasOperation(params: {
  projectId: string
  operationId: string
  input: Readonly<Record<string, unknown>>
  context?: Readonly<Record<string, unknown>>
  operationRequestId: string
  approvalGrantId: string
}): Promise<unknown> {
  return await requestJsonWithError<unknown>(
    `/api/projects/${encodeURIComponent(params.projectId)}/operations/${encodeURIComponent(params.operationId)}/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': params.operationRequestId },
      body: JSON.stringify({ input: params.input, context: params.context ?? {}, approvalGrantId: params.approvalGrantId, operationRequestId: params.operationRequestId }),
    },
  )
}
