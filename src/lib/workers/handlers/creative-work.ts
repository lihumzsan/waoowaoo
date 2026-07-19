import type { Job } from 'bullmq'
import { aisdk } from '@openai/agents-extensions/ai-sdk'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
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

function appendProgressEvent(
  lifecycle: CreativeWorkTaskLifecycleProjection,
  event: Extract<CreativeWorkerEvent, { kind: 'skills_discovered' | 'skill_read' }>,
): CreativeWorkTaskLifecycleProjection {
  const normalizedEvent = event.kind === 'skills_discovered'
    ? { ...event, tags: [...event.tags], skillIds: [...event.skillIds] }
    : event
  return {
    ...lifecycle,
    events: [
      ...lifecycle.events,
      {
        sequence: lifecycle.events.length + 1,
        occurredAt: new Date().toISOString(),
        event: normalizedEvent,
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
        if (event.kind !== 'skills_discovered' && event.kind !== 'skill_read') return
        lifecycle = appendProgressEvent(lifecycle, event)
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
