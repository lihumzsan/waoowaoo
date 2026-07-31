import { describeUnknownError } from '@/lib/errors/normalize'
import { type InternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { TaskTerminatedError } from '@/lib/task/errors'
import { isTaskActive } from '@/lib/task/service'
import { reportTaskProgress } from '../progress'
import { assertTaskActive } from '../provider-media'
import type { TaskExecutionContext } from '../context'
import {
  createWorkerLLMStreamPublisher,
  type WorkerLLMStreamContext,
} from './llm-stream-publisher'

type WorkerLLMStreamInputChunk = Omit<
  Parameters<NonNullable<InternalLLMStreamCallbacks['onChunk']>>[0],
  'seq'
>

export type WorkerInternalLLMStreamCallbacks = Omit<
  InternalLLMStreamCallbacks,
  'onChunk' | 'flush'
> & {
  onChunk?: (chunk: WorkerLLMStreamInputChunk) => void
  flush: () => Promise<void>
}

export type WorkerLLMActiveController = {
  assertActive?: (stage: string) => Promise<void>
  isActive?: () => Promise<boolean>
}

export function createWorkerLLMStreamContext(
  context: TaskExecutionContext,
  label = 'worker',
): WorkerLLMStreamContext {
  return {
    streamRunId: `run:${context.data.taskId}:${label}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    nextSeqByStepLane: {},
  }
}

export function createWorkerLLMStreamCallbacks(
  context: TaskExecutionContext,
  streamContext: WorkerLLMStreamContext,
  activeController?: WorkerLLMActiveController,
  options?: { readonly maxChunkChars?: number },
): WorkerInternalLLMStreamCallbacks {
  const activeProbeIntervalMs = 600
  let publishQueue: Promise<void> = Promise.resolve()
  let terminatedError: TaskTerminatedError | null = null
  let publishError: unknown = null
  let checkingActive = false
  let lastActiveProbeAt = 0

  const markTerminated = (stage: string) => {
    if (terminatedError) return
    terminatedError = new TaskTerminatedError(
      context.data.taskId,
      `Task terminated during ${stage}`,
    )
  }

  const ensureActiveOrThrow = (stage: string) => {
    void stage
    if (terminatedError) throw terminatedError
    if (publishError) throw publishError
  }

  const assertActive = async (stage: string) => {
    if (activeController?.assertActive) {
      await activeController.assertActive(stage)
      return
    }
    await assertTaskActive(context, stage)
  }

  const probeActive = async () => {
    if (activeController?.isActive) {
      return await activeController.isActive()
    }
    if (context.signal.aborted) return false
    return await isTaskActive(context.data.taskId)
  }

  const scheduleActiveProbe = () => {
    if (terminatedError || checkingActive) return
    const now = Date.now()
    if (now - lastActiveProbeAt < activeProbeIntervalMs) return
    checkingActive = true
    lastActiveProbeAt = now
    void probeActive()
      .then((active) => {
        if (!active) {
          markTerminated('worker_llm_stream_probe')
        }
      })
      .finally(() => {
        checkingActive = false
      })
  }

  const enqueue = (stage: string, work: () => Promise<void>) => {
    ensureActiveOrThrow(stage)
    scheduleActiveProbe()
    publishQueue = publishQueue
      .then(async () => {
        ensureActiveOrThrow(stage)
        await assertActive(stage)
        await work()
      })
      .catch((error) => {
        if (error instanceof TaskTerminatedError) {
          markTerminated(stage)
          return
        }
        publishError = error
      })
  }

  const streamPublisher = createWorkerLLMStreamPublisher({
    task: context,
    context: streamContext,
    enqueue,
    ...(options?.maxChunkChars ? { maxChunkChars: options.maxChunkChars } : {}),
  })

  return {
    onStage: ({ stage, provider, step }) => {
      ensureActiveOrThrow(`worker_llm_stage:${stage}`)
      scheduleActiveProbe()
      streamPublisher.flush()
      const stageLabel =
        stage === 'submit'
          ? 'progress.runtime.stage.llmSubmit'
          : stage === 'streaming'
            ? 'progress.runtime.stage.llmStreaming'
            : stage === 'fallback'
              ? 'progress.runtime.stage.llmFallbackNonStream'
              : 'progress.runtime.stage.llmCompleted'
      const stageKey = `worker_llm_${stage}`
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue(`worker_llm_stage:${stage}`, async () => {
        await reportTaskProgress(context, 65, {
          stage: stageKey,
          stageLabel,
          displayMode: 'detail',
          message: stageLabel,
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepAttempt ? { stepAttempt } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
          meta: {
            provider: provider || null,
          },
        })
      })
    },
    onChunk: ({ kind, delta, lane, step }) => {
      ensureActiveOrThrow('worker_llm_stream')
      scheduleActiveProbe()
      if (!delta) return
      streamPublisher.append({ kind, delta, lane, step })
    },
    onComplete: (text, step) => {
      ensureActiveOrThrow('worker_llm_complete')
      streamPublisher.flush()
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue('worker_llm_complete', async () => {
        await reportTaskProgress(context, 90, {
          stage: 'worker_llm_complete',
          stageLabel: 'progress.runtime.stage.llmCompleted',
          displayMode: 'detail',
          message: 'progress.runtime.llm.completed',
          done: true,
          ...(typeof text === 'string' ? { output: text } : {}),
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepAttempt ? { stepAttempt } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
        })
      })
    },
    onError: (error, step) => {
      if (error instanceof TaskTerminatedError) {
        markTerminated('worker_llm_error')
        throw error
      }
      ensureActiveOrThrow('worker_llm_error')
      streamPublisher.flush()
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue('worker_llm_error', async () => {
        await reportTaskProgress(context, 90, {
          stage: 'worker_llm_error',
          stageLabel: 'progress.runtime.stage.llmFailed',
          displayMode: 'detail',
          message: describeUnknownError(error),
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepAttempt ? { stepAttempt } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
        })
      })
    },
    async flush() {
      streamPublisher.flush()
      await publishQueue
      if (terminatedError) {
        throw terminatedError
      }
      if (publishError) throw publishError
    },
  }
}
