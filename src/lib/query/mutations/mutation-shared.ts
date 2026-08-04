import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { createClientApiError, type ClientApiError } from '@/lib/errors/client'
import { isTaskType, type TaskType } from '@/lib/task/types'
import { requireOperationMutationResponse } from '@/lib/operations/mutation-receipt'
import { syncWorkspaceResourceChanges } from '@/lib/query/resource-change-sync'

export { getPageLocale } from '@/lib/api-fetch'

export type MutationRequestError = ClientApiError

export type TaskSubmissionReceipt = {
  taskId: string
  taskType: TaskType
}

export function requireTaskSubmissionReceipt(value: unknown): TaskSubmissionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_SUBMISSION_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
  const taskType = typeof record.taskType === 'string' ? record.taskType.trim() : ''
  if (!taskId || !isTaskType(taskType)) throw new Error('TASK_SUBMISSION_RECEIPT_INVALID')
  return { taskId, taskType }
}

async function parseJsonSafe(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => ({}))
  if (data && typeof data === 'object') return data as Record<string, unknown>
  return {}
}

function createRequestError(
  status: number,
  payload: Record<string, unknown>,
): MutationRequestError {
  return createClientApiError(payload, status)
}

export async function requestJsonWithError<T>(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<T> {
  const response = await apiFetch(input, init)
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    throw createRequestError(response.status, data)
  }
  return data as T
}

export async function readOperationMutationResponseWithError(
  response: Response,
  queryClient: QueryClient,
): Promise<unknown> {
  const payload = await parseJsonSafe(response)
  if (!response.ok) {
    throw createRequestError(response.status, payload)
  }
  const result = requireOperationMutationResponse(payload)
  await syncWorkspaceResourceChanges({
    queryClient,
    changes: result.mutationReceipt.changedRefs,
  })
  return result.data
}

/**
 * Sole browser adapter for a synchronous Operation mutation response.
 * It validates the formal receipt, performs the registry-derived Query handoff,
 * and only then exposes domain data to the caller.
 */
export async function requestOperationMutationWithError(
  input: RequestInfo | URL,
  init: RequestInit,
  queryClient: QueryClient,
): Promise<unknown> {
  const response = await apiFetch(input, init)
  return await readOperationMutationResponseWithError(
    response,
    queryClient,
  )
}

export async function requestOperationMutationVoidWithError(
  input: RequestInfo | URL,
  init: RequestInit,
  queryClient: QueryClient,
): Promise<void> {
  await requestOperationMutationWithError(
    input,
    init,
    queryClient,
  )
}

export async function requestVoidWithError(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<void> {
  const response = await apiFetch(input, init)
  if (response.ok) return
  const data = await parseJsonSafe(response)
  throw createRequestError(response.status, data)
}

export async function requestTaskResponseWithError(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const response = await apiFetch(input, init)
  if (response.ok) return response
  const data = await parseJsonSafe(response)
  throw createRequestError(response.status, data)
}

export async function requestBlobWithError(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Blob> {
  const response = await apiFetch(input, init)
  if (response.ok) {
    return await response.blob()
  }

  const data = await parseJsonSafe(response)
  throw createRequestError(response.status, data)
}

export async function invalidateQueryTemplates(
  queryClient: QueryClient,
  templates: QueryKey[],
): Promise<void> {
  await Promise.all(
    templates.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )
}
