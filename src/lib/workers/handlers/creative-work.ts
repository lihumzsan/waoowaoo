import type { Job } from 'bullmq'
import { aisdk } from '@openai/agents-extensions/ai-sdk'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import { getLogContext } from '@/lib/logging/context'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
  creativeWorkerResultSchema,
  runCreativeWorker,
  summarizeCreativeWorkOutput,
} from '@/lib/creative-worker'
import {
  applyCreativeWorkerLifecycleEvent,
  isDurableCreativeWorkerTraceEvent,
} from '@/lib/creative-worker/lifecycle-projection'
import {
  resolveProjectAgentLanguageModel,
} from '@/lib/project-agent/model'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskAttemptExecutionContext } from '@/lib/workers/task-execution-deadline'
import {
  createWorkerLLMStreamCallbacks,
  createWorkerLLMStreamContext,
} from './llm-stream'

export async function handleCreativeWorkTask(
  job: Job<TaskJobData>,
  execution: TaskAttemptExecutionContext,
) {
  const payload = creativeWorkTaskPayloadSchema.parse(job.data.payload || {})
  await reportTaskProgress(job, 10, {
    stage: 'creative_work_prepare',
    displayMode: 'detail',
    lifecycleProjection: payload.lifecycleProjection,
  })
  await assertTaskActive(job, 'creative_work_prepare')

  const resolved = await resolveProjectAgentLanguageModel({
    userId: job.data.userId,
    modelKey: payload.modelKey,
    reasoningPurpose: 'analysis',
    promptCacheHorizon: 'one_shot',
    projectId: job.data.projectId,
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
  const streamContext = createWorkerLLMStreamContext(job, 'creative-work')
  const streamCallbacks = createWorkerLLMStreamCallbacks(
    job,
    streamContext,
    undefined,
    { maxChunkChars: 64 },
  )
  let result: Awaited<ReturnType<typeof runCreativeWorker>>
  try {
    result = await runCreativeWorker({
      model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
      signal: execution.signal,
      request: payload.request,
      onEvent: async (event) => {
        if (event.kind === 'output_boundary') {
          await streamCallbacks.flush()
          return
        }
        if (event.kind === 'reasoning_delta') {
          const reasoningId = `${String(attempt)}:${event.reasoningId}`
          streamCallbacks.onChunk?.({
            kind: 'reasoning',
            delta: event.delta,
            lane: 'reasoning',
            step: {
              id: reasoningId,
              attempt: attempt!,
              title: 'Creative Worker reasoning',
              index: 1,
              total: 1,
            },
          })
          return
        }
        if (event.kind === 'output_delta') {
          streamCallbacks.onChunk?.({
            kind: 'text',
            delta: event.delta,
            lane: 'structured-output',
            step: {
              id: `${String(attempt)}:structured-output`,
              attempt: attempt!,
              title: 'Creative Worker structured output',
              index: 1,
              total: 1,
            },
          })
          return
        }
        if (!isDurableCreativeWorkerTraceEvent(event)) return
        if (event.kind === 'started') return
        if (event.kind === 'skill_read' && event.trace.source === 'tool') return
        lifecycle = applyCreativeWorkerLifecycleEvent({
          lifecycle,
          rawEvent: event,
          attempt: attempt!,
          occurredAt: new Date().toISOString(),
        })
        const progress = Math.min(85, 20 + lifecycle.events.length * 5)
        await reportTaskProgress(job, progress, {
          stage: 'creative_work_reasoning',
          displayMode: 'detail',
          lifecycleProjection: lifecycle,
        })
        if (event.kind === 'reasoning' && event.status === 'completed') {
          await streamCallbacks.flush()
        }
      },
    })
  } finally {
    await streamCallbacks.flush()
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
