import type { LLMStreamChunk } from '@/lib/llm-observe/types'
import type { TaskExecutionContext } from './context'
import {
  publishTaskEvent,
  publishTaskStreamEvent,
} from '../publisher'
import {
  buildTaskProgressMessage,
  getTaskStageLabel,
} from '../progress-message'
import { tryUpdateTaskProgress } from '../service'
import {
  TASK_EVENT_TYPE,
  type TaskExecutionData,
} from '../types'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readStringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readPositiveIntField(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function taskProgressContext(
  data: TaskExecutionData,
): Record<string, unknown> {
  const payload = toObject(data.payload)
  const flowId = readStringField(payload, 'flowId')
  const flowStageTitle = readStringField(payload, 'flowStageTitle')
  const flowStageIndex = readPositiveIntField(payload, 'flowStageIndex')
  const flowStageTotal = readPositiveIntField(payload, 'flowStageTotal')

  return {
    ...(flowId ? { flowId } : {}),
    ...(flowStageTitle ? { flowStageTitle } : {}),
    ...(flowStageIndex ? { flowStageIndex } : {}),
    ...(flowStageTotal ? { flowStageTotal } : {}),
  }
}

function buildProgressPayload(
  data: TaskExecutionData,
  payload?: Record<string, unknown> | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(payload ?? {}),
  }
  for (const [key, value] of Object.entries(taskProgressContext(data))) {
    if (next[key] === undefined || next[key] === null || next[key] === '') {
      next[key] = value
    }
  }

  const meta = toObject(next.meta)
  if (meta.locale === undefined || meta.locale === null || meta.locale === '') {
    next.meta = {
      ...meta,
      locale: data.locale,
    }
  }
  return next
}

export async function reportTaskProgress(
  context: TaskExecutionContext,
  progress: number,
  payload?: Record<string, unknown>,
): Promise<void> {
  context.heartbeat()
  await projectTaskProgress({
    data: context.data,
    attempt: context.attempt,
    progress,
    payload,
  })
}

export async function projectTaskProgress(input: {
  data: TaskExecutionData
  attempt: number
  progress: number
  payload?: Record<string, unknown>
}): Promise<void> {
  const data = input.data
  const value = Math.max(0, Math.min(99, Math.floor(input.progress)))
  const nextPayload = buildProgressPayload(data, input.payload)
  const stage = typeof nextPayload.stage === 'string'
    ? nextPayload.stage
    : null

  if (stage && typeof nextPayload.stageLabel !== 'string') {
    nextPayload.stageLabel = getTaskStageLabel(stage)
  }
  if (typeof nextPayload.displayMode !== 'string') {
    nextPayload.displayMode = 'loading'
  }
  if (typeof nextPayload.message !== 'string') {
    nextPayload.message = buildTaskProgressMessage({
      eventType: TASK_EVENT_TYPE.PROGRESS,
      taskType: data.type,
      progress: value,
      payload: nextPayload,
    })
  }

  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error(`TASK_ATTEMPT_CONTEXT_REQUIRED:${data.taskId}`)
  }
  const updated = await tryUpdateTaskProgress(
    data.taskId,
    input.attempt,
    value,
    nextPayload,
  )
  if (!updated) return

  await publishTaskEvent({
    taskId: data.taskId,
    projectId: data.projectId,
    userId: data.userId,
    type: TASK_EVENT_TYPE.PROGRESS,
    taskType: data.type,
    targetType: data.targetType,
    targetId: data.targetId,
    payload: {
      progress: value,
      ...nextPayload,
      trace: {
        requestId: data.trace?.requestId || null,
      },
    },
    persist: false,
  })
}

export async function reportTaskStreamChunk(
  context: TaskExecutionContext,
  chunk: LLMStreamChunk,
  payload?: Record<string, unknown>,
): Promise<void> {
  context.heartbeat()
  const data = context.data
  const mergedPayload = buildProgressPayload(data, {
    ...(payload ?? {}),
    displayMode: 'detail',
    stream: chunk,
    done: false,
    message: payload?.message
      || (chunk.kind === 'reasoning'
        ? 'progress.runtime.llm.reasoning'
        : 'progress.runtime.llm.output'),
  })

  await publishTaskStreamEvent({
    taskId: data.taskId,
    projectId: data.projectId,
    userId: data.userId,
    taskType: data.type,
    targetType: data.targetType,
    targetId: data.targetId,
    payload: {
      ...mergedPayload,
      trace: {
        requestId: data.trace?.requestId || null,
      },
    },
  })
}
