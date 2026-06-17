import type { UIMessage } from 'ai'
import type {
  EditStylePreviewGenerationPartData,
  TaskBatchSubmittedPartData,
  TaskSubmittedPartData,
} from '@/lib/project-agent/types'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, TASK_TYPE, type SSEEvent } from '@/lib/task/types'

type UnknownRecord = Record<string, unknown>

export type AssistantAsyncTaskSubmission =
  | {
    kind: 'single'
    operationId: string
    taskId: string
    data: TaskSubmittedPartData
  }
  | {
    kind: 'batch'
    operationId: string
    taskId: string
    batchKey: string
    data: TaskBatchSubmittedPartData
  }

export type AssistantAsyncTaskTerminalEvent = {
  taskId: string
  lifecycleType: typeof TASK_EVENT_TYPE.COMPLETED | typeof TASK_EVENT_TYPE.FAILED
}

export type AssistantExternalTaskWait = {
  operationId: string
  taskIds: string[]
}

export type AssistantExternalTaskTargetQuery = {
  targetType: string
  targetId: string
  types?: string[]
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readOptionalString(value: unknown): string | null | undefined {
  if (value === null) return null
  return readNonEmptyString(value) ?? undefined
}

function readStylePreviewKey(value: unknown): 'style_a' | 'style_b' | 'style_c' | null {
  const key = readNonEmptyString(value)
  if (key === 'style_a' || key === 'style_b' || key === 'style_c') return key
  return null
}

function readStylePreviewAspectRatio(value: unknown): '9:16' | '16:9' | '21:9' | null {
  const aspectRatio = readNonEmptyString(value)
  if (aspectRatio === '9:16' || aspectRatio === '16:9' || aspectRatio === '21:9') return aspectRatio
  return null
}

function readTaskSubmittedPartData(value: unknown): TaskSubmittedPartData | null {
  if (!isRecord(value)) return null
  const operationId = readNonEmptyString(value.operationId)
  const taskId = readNonEmptyString(value.taskId)
  const status = readNonEmptyString(value.status)
  if (!operationId || !taskId || !status) return null
  const runId = readOptionalString(value.runId)
  const mutationBatchId = readOptionalString(value.mutationBatchId)
  const projectId = readNonEmptyString(value.projectId)
  const episodeId = readOptionalString(value.episodeId)
  const taskType = readNonEmptyString(value.taskType)
  const targetType = readNonEmptyString(value.targetType)
  const targetId = readNonEmptyString(value.targetId)
  return {
    operationId,
    taskId,
    status,
    ...(runId !== undefined ? { runId } : {}),
    ...(typeof value.deduped === 'boolean' ? { deduped: value.deduped } : {}),
    ...(mutationBatchId !== undefined ? { mutationBatchId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(episodeId !== undefined ? { episodeId } : {}),
    ...(taskType ? { taskType } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
  }
}

function readTaskBatchSubmittedPartData(value: unknown): TaskBatchSubmittedPartData | null {
  if (!isRecord(value)) return null
  const operationId = readNonEmptyString(value.operationId)
  if (!operationId) return null
  const taskIds = Array.isArray(value.taskIds)
    ? value.taskIds.map(readNonEmptyString).filter((item): item is string => Boolean(item))
    : []
  if (taskIds.length === 0) return null
  const total = typeof value.total === 'number' && Number.isFinite(value.total)
    ? value.total
    : taskIds.length
  const taskTotal = typeof value.taskTotal === 'number' && Number.isFinite(value.taskTotal)
    ? value.taskTotal
    : undefined
  const explicitTargetTotal = typeof value.targetTotal === 'number' && Number.isFinite(value.targetTotal)
    ? value.targetTotal
    : undefined
  const mutationBatchId = readOptionalString(value.mutationBatchId)
  const results = Array.isArray(value.results)
    ? value.results.flatMap((item) => {
      if (!isRecord(item)) return []
      const refId = readNonEmptyString(item.refId)
      const taskId = readNonEmptyString(item.taskId)
      const taskType = readNonEmptyString(item.taskType)
      const targetType = readNonEmptyString(item.targetType)
      const targetId = readNonEmptyString(item.targetId)
      return refId && taskId
        ? [{
            refId,
            taskId,
            ...(taskType ? { taskType } : {}),
            ...(targetType ? { targetType } : {}),
            ...(targetId ? { targetId } : {}),
          }]
        : []
    })
    : undefined
  const targetTotal = explicitTargetTotal ?? results?.length
  return {
    operationId,
    total,
    ...(taskTotal !== undefined ? { taskTotal } : {}),
    ...(targetTotal !== undefined ? { targetTotal } : {}),
    taskIds,
    ...(results ? { results } : {}),
    ...(mutationBatchId !== undefined ? { mutationBatchId } : {}),
  }
}

export function collectAssistantAsyncTaskSubmissions(messages: readonly UIMessage[]): Map<string, AssistantAsyncTaskSubmission> {
  const submissions = new Map<string, AssistantAsyncTaskSubmission>()
  for (const message of messages) {
    const parts: readonly unknown[] = message.parts
    for (const part of parts) {
      if (!isRecord(part)) continue
      if (part.type === 'data-task-submitted') {
        const data = readTaskSubmittedPartData(part.data)
        if (!data) continue
        submissions.set(data.taskId, {
          kind: 'single',
          operationId: data.operationId,
          taskId: data.taskId,
          data,
        })
      }
      if (part.type === 'data-task-batch-submitted') {
        const data = readTaskBatchSubmittedPartData(part.data)
        if (!data) continue
        const batchKey = `${data.operationId}:${data.taskIds.join(',')}`
        for (const taskId of data.taskIds) {
          submissions.set(taskId, {
            kind: 'batch',
            operationId: data.operationId,
            taskId,
            batchKey,
            data,
          })
        }
      }
    }
  }
  return submissions
}

function readAgentStopExternalTaskWait(value: unknown): AssistantExternalTaskWait | null {
  if (!isRecord(value)) return null
  if (value.reason !== 'awaiting_external_task') return null
  const operationIds = Array.isArray(value.operationIds)
    ? value.operationIds.map(readNonEmptyString).filter((item): item is string => Boolean(item))
    : []
  const taskIds = Array.isArray(value.taskIds)
    ? value.taskIds.map(readNonEmptyString).filter((item): item is string => Boolean(item))
    : []
  const operationId = operationIds[0]
  if (!operationId || taskIds.length === 0) return null
  return {
    operationId,
    taskIds,
  }
}

export function findLatestAssistantExternalTaskWait(messages: readonly UIMessage[]): AssistantExternalTaskWait | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!isRecord(part) || part.type !== 'data-agent-stop') continue
      const wait = readAgentStopExternalTaskWait(part.data)
      if (wait) return wait
    }
  }
  return null
}

export function buildAssistantExternalTaskWaitTargets(
  wait: AssistantExternalTaskWait | null,
  submissions: ReadonlyMap<string, AssistantAsyncTaskSubmission>,
): AssistantExternalTaskTargetQuery[] {
  if (!wait) return []
  const targets = wait.taskIds.flatMap((taskId) => {
    const submission = submissions.get(taskId)
    if (!submission) return []
    if (submission.kind === 'single') {
      const { targetType, targetId, taskType } = submission.data
      if (!targetType || !targetId) return []
      return [{
        targetType,
        targetId,
        ...(taskType ? { types: [taskType] } : {}),
      }]
    }

    const result = submission.data.results?.find((item) => item.taskId === taskId)
    if (!result?.targetType || !result.targetId) return []
    return [{
      targetType: result.targetType,
      targetId: result.targetId,
      ...(result.taskType ? { types: [result.taskType] } : {}),
    }]
  })
  const deduped = new Map<string, AssistantExternalTaskTargetQuery>()
  for (const target of targets) {
    deduped.set(`${target.targetType}:${target.targetId}:${target.types?.join(',') ?? ''}`, target)
  }
  return Array.from(deduped.values())
}

function readOperationResult(payload: unknown): UnknownRecord | null {
  if (!isRecord(payload)) return null
  if (payload.ok === true && isRecord(payload.data)) return payload.data
  return isRecord(payload.result) ? payload.result : null
}

export function createTaskSubmittedDataFromOperationPayload(params: {
  payload: unknown
  operationId: string
  projectId: string
  episodeId?: string | null
}): TaskSubmittedPartData | null {
  const result = readOperationResult(params.payload)
  if (!result) return null
  const success = result.success === true
  const isAsync = result.async === true
  const taskId = readNonEmptyString(result.taskId)
  const status = readNonEmptyString(result.status)
  if (!success || !isAsync || !taskId || !status) return null
  const resultEpisodeId = readOptionalString(result.episodeId)
  const episodeId = resultEpisodeId !== undefined ? resultEpisodeId : params.episodeId ?? null
  const mutationBatchId = readOptionalString(result.mutationBatchId)
  const projectId = readNonEmptyString(result.projectId) ?? params.projectId
  const taskType = readNonEmptyString(result.taskType)
  const targetType = readNonEmptyString(result.targetType)
  const targetId = readNonEmptyString(result.targetId)
  const inferredEditScriptTarget = params.operationId === 'generate_edit_script' && episodeId
    ? {
        taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        targetType: 'ProjectEpisode',
        targetId: episodeId,
      }
    : null
  return {
    operationId: params.operationId,
    taskId,
    status,
    runId: readOptionalString(result.runId) ?? null,
    ...(typeof result.deduped === 'boolean' ? { deduped: result.deduped } : {}),
    ...(mutationBatchId !== undefined ? { mutationBatchId } : {}),
    projectId,
    episodeId,
    taskType: taskType ?? inferredEditScriptTarget?.taskType,
    targetType: targetType ?? inferredEditScriptTarget?.targetType,
    targetId: targetId ?? inferredEditScriptTarget?.targetId,
  }
}

export function createTaskBatchSubmittedDataFromOperationPayload(params: {
  payload: unknown
  operationId: string
}): TaskBatchSubmittedPartData | null {
  const result = readOperationResult(params.payload)
  if (!result) return null
  if (result.success !== true || result.async !== true) return null
  const taskIds = Array.isArray(result.taskIds)
    ? result.taskIds.map(readNonEmptyString).filter((item): item is string => Boolean(item))
    : []
  if (taskIds.length === 0) return null
  const total = typeof result.total === 'number' && Number.isFinite(result.total)
    ? result.total
    : taskIds.length
  const taskTotal = typeof result.taskTotal === 'number' && Number.isFinite(result.taskTotal)
    ? result.taskTotal
    : undefined
  const explicitTargetTotal = typeof result.targetTotal === 'number' && Number.isFinite(result.targetTotal)
    ? result.targetTotal
    : undefined
  const mutationBatchId = readOptionalString(result.mutationBatchId)
  const results = Array.isArray(result.results)
    ? result.results.flatMap((item) => {
      if (!isRecord(item)) return []
      const refId = readNonEmptyString(item.refId)
      const taskId = readNonEmptyString(item.taskId)
      const taskType = readNonEmptyString(item.taskType)
      const targetType = readNonEmptyString(item.targetType)
      const targetId = readNonEmptyString(item.targetId)
      return refId && taskId
        ? [{
            refId,
            taskId,
            ...(taskType ? { taskType } : {}),
            ...(targetType ? { targetType } : {}),
            ...(targetId ? { targetId } : {}),
          }]
        : []
    })
    : undefined
  const targetTotal = explicitTargetTotal ?? results?.length
  return {
    operationId: params.operationId,
    total,
    ...(taskTotal !== undefined ? { taskTotal } : {}),
    ...(targetTotal !== undefined ? { targetTotal } : {}),
    taskIds,
    ...(results ? { results } : {}),
    ...(mutationBatchId !== undefined ? { mutationBatchId } : {}),
  }
}

export function createEditStylePreviewGenerationDataFromOperationPayload(params: {
  payload: unknown
  operationId: string
}): EditStylePreviewGenerationPartData | null {
  if (params.operationId !== 'generate_edit_style_previews') return null
  const result = readOperationResult(params.payload)
  if (!result) return null
  const projectId = readNonEmptyString(result.projectId)
  const episodeId = readNonEmptyString(result.episodeId)
  const screenplayId = readNonEmptyString(result.screenplayId)
  if (!projectId || !episodeId || !screenplayId) return null
  const items = Array.isArray(result.stylePreviews)
    ? result.stylePreviews.flatMap((item) => {
      if (!isRecord(item)) return []
      const id = readNonEmptyString(item.id)
      const title = readNonEmptyString(item.title)
      const summary = readNonEmptyString(item.summary)
      const taskId = readNonEmptyString(item.taskId)
      const aspectRatio = readStylePreviewAspectRatio(item.aspectRatio)
      const styleKey = readStylePreviewKey(item.styleKey)
      return id && title && summary && taskId && styleKey
        ? [{
            id,
            styleKey,
            title,
            summary,
            taskId,
            ...(aspectRatio ? { aspectRatio } : {}),
          }]
        : []
    })
    : []
  if (items.length === 0) return null
  return {
    operationId: 'generate_edit_style_previews',
    projectId,
    episodeId,
    screenplayId,
    items,
  }
}

export function resolveAssistantAsyncTaskTerminalEvent(event: SSEEvent): AssistantAsyncTaskTerminalEvent | null {
  if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return null
  const lifecycleType = event.payload?.lifecycleType
  if (lifecycleType !== TASK_EVENT_TYPE.COMPLETED && lifecycleType !== TASK_EVENT_TYPE.FAILED) return null
  return {
    taskId: event.taskId,
    lifecycleType,
  }
}
