import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'
import type { LLMStreamKind } from '@/lib/llm-observe/types'
import { reportTaskStreamChunk } from '../progress'
import type { TaskExecutionContext } from '../context'

export type WorkerLLMStreamContext = {
  streamRunId: string
  nextSeqByStepLane: Record<string, number>
}

interface BufferedStreamChunk {
  readonly kind: LLMStreamKind
  readonly lane: string
  readonly stepId: string | null
  readonly stepAttempt: number | null
  readonly stepTitle: string | null
  readonly stepIndex: number | null
  readonly stepTotal: number | null
  delta: string
}

function nextStreamSeq(context: WorkerLLMStreamContext, stepId: string | null, lane: string): number {
  const key = `${stepId || '__default'}|${lane || 'main'}`
  const current = context.nextSeqByStepLane[key] || 1
  context.nextSeqByStepLane[key] = current + 1
  return current
}

function normalizeStep(step: InternalLLMStreamStepMeta | null | undefined) {
  const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
  const stepAttempt = typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
    ? Math.max(1, Math.floor(step.attempt))
    : null
  const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
  const stepIndex = typeof step?.index === 'number' && Number.isFinite(step.index)
    ? Math.max(1, Math.floor(step.index))
    : null
  const stepTotal = typeof step?.total === 'number' && Number.isFinite(step.total)
    ? Math.max(stepIndex || 1, Math.floor(step.total))
    : null
  return { stepId, stepAttempt, stepTitle, stepIndex, stepTotal }
}

export function createWorkerLLMStreamPublisher(input: {
  readonly task: TaskExecutionContext
  readonly context: WorkerLLMStreamContext
  readonly enqueue: (stage: string, work: () => Promise<void>) => void
  readonly maxChunkChars?: number
}) {
  const maxChunkChars = input.maxChunkChars ?? 512
  if (!Number.isSafeInteger(maxChunkChars) || maxChunkChars <= 0) {
    throw new Error('WORKER_LLM_STREAM_CHUNK_SIZE_INVALID')
  }
  const buffered = new Map<string, BufferedStreamChunk>()

  const publish = (chunk: BufferedStreamChunk) => {
    if (!chunk.delta) return
    const seq = nextStreamSeq(input.context, chunk.stepId, chunk.lane)
    input.enqueue('worker_llm_stream', async () => {
      await reportTaskStreamChunk(
        input.task,
        {
          kind: chunk.kind,
          delta: chunk.delta,
          seq,
          lane: chunk.lane,
        },
        {
          stage: 'worker_llm_stream',
          stageLabel: 'progress.runtime.stage.llmStreaming',
          displayMode: 'detail',
          done: false,
          message: chunk.kind === 'reasoning' ? 'progress.runtime.llm.reasoning' : 'progress.runtime.llm.output',
          streamRunId: input.context.streamRunId,
          ...(chunk.stepId ? { stepId: chunk.stepId } : {}),
          ...(chunk.stepAttempt ? { stepAttempt: chunk.stepAttempt } : {}),
          ...(chunk.stepTitle ? { stepTitle: chunk.stepTitle } : {}),
          ...(chunk.stepIndex ? { stepIndex: chunk.stepIndex } : {}),
          ...(chunk.stepTotal ? { stepTotal: chunk.stepTotal } : {}),
        },
      )
    })
  }

  return {
    append(params: {
      readonly kind: LLMStreamKind
      readonly delta: string
      readonly lane?: string | null
      readonly step?: InternalLLMStreamStepMeta | null
    }) {
      const step = normalizeStep(params.step)
      const lane = params.lane || (params.kind === 'reasoning' ? 'reasoning' : 'main')
      const key = `${step.stepId ?? '__default'}|${step.stepAttempt ?? 0}|${lane}|${params.kind}`
      const current = buffered.get(key)
      let combined = `${current?.delta ?? ''}${params.delta}`
      while (combined.length >= maxChunkChars) {
        publish({ ...step, kind: params.kind, lane, delta: combined.slice(0, maxChunkChars) })
        combined = combined.slice(maxChunkChars)
      }
      if (combined) {
        buffered.set(key, { ...step, kind: params.kind, lane, delta: combined })
      } else {
        buffered.delete(key)
      }
    },
    flush() {
      for (const [key, chunk] of buffered) {
        buffered.delete(key)
        publish(chunk)
      }
    },
  }
}
