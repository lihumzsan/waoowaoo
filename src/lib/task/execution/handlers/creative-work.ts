import { aisdk } from '@openai/agents-extensions/ai-sdk'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
  creativeWorkTaskLifecycleProjectionSchema,
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
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive } from '../provider-media'
import { executeTaskDurableInvocation } from '@/lib/task/provider-invocation'
import {
  createWorkerLLMStreamCallbacks,
  createWorkerLLMStreamContext,
} from './llm-stream'

function parseDurableCreativeWorkerResult(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CREATIVE_WORK_DURABLE_RESULT_INVALID')
  }
  const record = value as Record<string, unknown>
  return {
    workerResult: creativeWorkerResultSchema.parse(record.workerResult),
    lifecycle: creativeWorkTaskLifecycleProjectionSchema.parse(
      record.lifecycle,
    ),
  }
}

export async function handleCreativeWorkTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  const payload = creativeWorkTaskPayloadSchema.parse(data.payload || {})
  await reportTaskProgress(context, 10, {
    stage: 'creative_work_prepare',
    displayMode: 'detail',
    lifecycleProjection: payload.lifecycleProjection,
  })
  await assertTaskActive(context, 'creative_work_prepare')

  const resolved = await resolveProjectAgentLanguageModel({
    userId: data.userId,
    modelKey: payload.modelKey,
    reasoningPurpose: 'analysis',
    promptCacheHorizon: 'one_shot',
    projectId: data.projectId,
    openRouterSessionId: buildAiExecutionSessionId({
      kind: 'project-agent',
      userId: data.userId,
      projectId: data.projectId,
      episodeId: data.episodeId ?? null,
      assistantId: 'creative-worker',
      action: payload.request.outputKind,
      modelKey: payload.modelKey,
    }),
  })

  let lifecycle = payload.lifecycleProjection
  const attempt = context.attempt
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`CREATIVE_WORK_TASK_ATTEMPT_REQUIRED:${data.taskId}`)
  }
  const streamContext = createWorkerLLMStreamContext(context, 'creative-work')
  const streamCallbacks = createWorkerLLMStreamCallbacks(
    context,
    streamContext,
    undefined,
    { maxChunkChars: 64 },
  )
  let result: Awaited<ReturnType<typeof runCreativeWorker>>
  try {
    const durable = await executeTaskDurableInvocation({
      taskId: data.taskId,
      invocation: { key: 'creative-worker:primary' },
      modality: 'llm-agent',
      provider: 'project-agent-language-model',
      modelKey: payload.modelKey,
      request: {
        inputFingerprint: payload.inputFingerprint,
        request: payload.request,
      },
      execute: async () => {
        const workerResult = await runCreativeWorker({
          model: aisdk(
            resolved.languageModel as unknown as Parameters<typeof aisdk>[0],
          ),
          signal: context.signal,
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
                  attempt,
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
                  attempt,
                  title: 'Creative Worker structured output',
                  index: 1,
                  total: 1,
                },
              })
              return
            }
            if (!isDurableCreativeWorkerTraceEvent(event)) return
            if (event.kind === 'started') return
            if (
              event.kind === 'skill_read'
              && event.trace.source === 'tool'
            ) {
              return
            }
            lifecycle = applyCreativeWorkerLifecycleEvent({
              lifecycle,
              rawEvent: event,
              attempt,
              occurredAt: new Date().toISOString(),
            })
            const progress = Math.min(
              85,
              20 + lifecycle.events.length * 5,
            )
            await reportTaskProgress(context, progress, {
              stage: 'creative_work_reasoning',
              displayMode: 'detail',
              lifecycleProjection: lifecycle,
            })
            if (
              event.kind === 'reasoning'
              && event.status === 'completed'
            ) {
              await streamCallbacks.flush()
            }
          },
        })
        return {
          workerResult,
          lifecycle,
        }
      },
      resultPolicy: {
        parse: parseDurableCreativeWorkerResult,
      },
    })
    result = durable.workerResult
    lifecycle = durable.lifecycle
  } finally {
    await streamCallbacks.flush()
  }

  await assertTaskActive(context, 'creative_work_finalize')
  const parsedResult = creativeWorkerResultSchema.parse(result)
  const summary = summarizeCreativeWorkOutput(parsedResult.output)
  await reportTaskProgress(context, 95, {
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
