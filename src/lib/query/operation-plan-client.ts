'use client'

import { apiFetch } from '@/lib/api-fetch'
import type { QueryClient } from '@tanstack/react-query'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { OperationPlanView } from '@/lib/operations/plan-contract'
import { readClientApiError } from '@/lib/errors/client'
import { requestJsonWithError, requestOperationMutationWithError } from '@/lib/query/mutations/mutation-shared'

export async function fetchOperationPlanView(params: {
  projectId: string
  operationId: string
  input: Record<string, unknown>
  context?: Record<string, unknown>
  operationRequestId?: string
}): Promise<OperationPlanView> {
  const operationRequestId = params.operationRequestId ?? createBrowserUuid()
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

export async function executeCanvasOperation(params: {
  projectId: string
  operationId: string
  input: Readonly<Record<string, unknown>>
  context?: Readonly<Record<string, unknown>>
  operationRequestId: string
  execution: { readonly kind: 'planned'; readonly planSnapshotId: string } | { readonly kind: 'direct' }
  queryClient: QueryClient
}): Promise<unknown> {
  const url = `/api/projects/${encodeURIComponent(params.projectId)}/operations/${encodeURIComponent(params.operationId)}/execute`
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': params.operationRequestId },
    body: JSON.stringify({
      input: params.input,
      context: params.context ?? {},
      operationRequestId: params.operationRequestId,
      ...(params.execution.kind === 'planned' ? { planSnapshotId: params.execution.planSnapshotId } : {}),
    }),
  }
  return params.execution.kind === 'direct'
    ? await requestOperationMutationWithError(url, init, params.queryClient)
    : await requestJsonWithError<unknown>(url, init)
}
