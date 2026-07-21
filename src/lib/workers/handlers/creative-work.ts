import type { Job } from 'bullmq'
import { aisdk } from '@openai/agents-extensions/ai-sdk'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import { getLogContext } from '@/lib/logging/context'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
  creativeWorkerResultSchema,
  CreativeWorkerError,
  runCreativeWorker,
  summarizeCreativeWorkOutput,
  type CreativeWorkTaskLifecycleProjection,
  type CreativeWorkerEvent,
} from '@/lib/creative-worker'
import {
  resolveProjectAgentLanguageModel,
} from '@/lib/project-agent/model'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { getWorkerExternalTimeoutMs } from '@/lib/workers/runtime-config'
import { assertTaskActive } from '@/lib/workers/utils'

type PersistedCreativeWorkerEvent = Extract<CreativeWorkerEvent, {
  kind: 'skill_read' | 'reasoning' | 'tool_called' | 'tool_completed' | 'tool_failed'
}>

function isPersistedCreativeWorkerEvent(
  event: CreativeWorkerEvent,
): event is PersistedCreativeWorkerEvent {
  return event.kind === 'skill_read'
    || event.kind === 'reasoning'
    || event.kind === 'tool_called'
    || event.kind === 'tool_completed'
    || event.kind === 'tool_failed'
}

function withAttemptIdentity(
  event: PersistedCreativeWorkerEvent,
  attempt: number,
): PersistedCreativeWorkerEvent {
  if (event.kind === 'reasoning') {
    return { ...event, reasoningId: `${String(attempt)}:${event.reasoningId}` }
  }
  if (
    event.kind === 'tool_called'
    || event.kind === 'tool_completed'
    || event.kind === 'tool_failed'
  ) return { ...event, toolCallId: `${String(attempt)}:${event.toolCallId}` }
  return event
}

function applyProgressEvent(
  lifecycle: CreativeWorkTaskLifecycleProjection,
  rawEvent: PersistedCreativeWorkerEvent,
  attempt: number,
): CreativeWorkTaskLifecycleProjection {
  const event = withAttemptIdentity(rawEvent, attempt)
  if (event.kind === 'reasoning') {
    const existingIndex = lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'reasoning'
      && entry.event.reasoningId === event.reasoningId
    ))
    if (existingIndex >= 0) {
      return {
        ...lifecycle,
        events: lifecycle.events.map((entry, index) => (
          index === existingIndex ? { ...entry, event } : entry
        )),
      }
    }
  }
  if (event.kind === 'tool_completed' || event.kind === 'tool_failed') {
    const existingIndex = lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'tool_called'
      && entry.event.toolCallId === event.toolCallId
    ))
    if (existingIndex < 0) {
      throw new Error(`CREATIVE_WORK_TOOL_CALL_PROJECTION_MISSING:${event.toolCallId}`)
    }
    return {
      ...lifecycle,
      events: lifecycle.events.map((entry, index) => (
        index === existingIndex ? { ...entry, event } : entry
      )),
    }
  }
  if (lifecycle.events.length >= 64) {
    throw new Error('CREATIVE_WORK_LIFECYCLE_PROJECTION_EXHAUSTED')
  }
  return {
    ...lifecycle,
    events: [
      ...lifecycle.events,
      {
        sequence: lifecycle.events.length + 1,
        occurredAt: new Date().toISOString(),
        event,
      },
    ],
  }
}

export async function handleCreativeWorkTask(job: Job<TaskJobData>) {
  const payload = creativeWorkTaskPayloadSchema.parse(job.data.payload || {})
  await reportTaskProgress(job, 10, {
    stage: 'creative_work_prepare',
    displayMode: 'detail',
    lifecycleProjection: payload.lifecycleProjection,
  })
  await assertTaskActive(job, 'creative_work_prepare')

  const resolved = await resolveProjectAgentLanguageModel({
    userId: job.data.userId,
    assistantModelKey: payload.modelKey,
    openRouterSessionId: buildAiExecutionSessionId({
      kind: 'project-agent',
      userId: job.data.userId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId ?? null,
      assistantId: 'creative-worker',
      action: payload.request.outputKind,
      modelKey: payload.modelKey,
    }),
  })

  let lifecycle = payload.lifecycleProjection
  const attempt = getLogContext().taskAttempt
  if (!Number.isInteger(attempt) || (attempt ?? 0) < 1) {
    throw new Error(`CREATIVE_WORK_TASK_ATTEMPT_REQUIRED:${job.data.taskId}`)
  }
  const abortController = new AbortController()
  const timeoutMs = getWorkerExternalTimeoutMs()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, timeoutMs)
  timeout.unref()
  let result: Awaited<ReturnType<typeof runCreativeWorker>>
  try {
    result = await runCreativeWorker({
      model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
      locale: job.data.locale,
      signal: abortController.signal,
      request: payload.request,
      onEvent: async (event) => {
        if (!isPersistedCreativeWorkerEvent(event)) return
        if (event.kind === 'skill_read' && event.trace.source === 'tool') return
        lifecycle = applyProgressEvent(lifecycle, event, attempt!)
        const progress = Math.min(85, 20 + lifecycle.events.length * 5)
        await reportTaskProgress(job, progress, {
          stage: 'creative_work_reasoning',
          displayMode: 'detail',
          lifecycleProjection: lifecycle,
        })
      },
    })
  } catch (error: unknown) {
    if (timedOut) {
      throw new CreativeWorkerError('CREATIVE_WORK_TIMEOUT', { timeoutMs }, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  await assertTaskActive(job, 'creative_work_finalize')
  const parsedResult = creativeWorkerResultSchema.parse(result)
  const summary = summarizeCreativeWorkOutput(parsedResult.output)
  await reportTaskProgress(job, 95, {
    stage: 'creative_work_finalize',
    displayMode: 'detail',
    lifecycleProjection: lifecycle,
  })

  return creativeWorkTaskResultSchema.parse({
    requestKey: payload.requestKey,
    outputKind: parsedResult.outputKind,
    summary,
    continuationProjection: {
      requestKey: payload.requestKey,
      outputKind: parsedResult.outputKind,
      summary,
    },
    lifecycleProjection: lifecycle,
    creativeWorkResult: parsedResult,
  })
}
