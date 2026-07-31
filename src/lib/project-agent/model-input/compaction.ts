import type { AgentInputItem } from '@openai/agents'
import { AppError } from '@/lib/errors/app-error'
import type { LlmUsageFact } from '@/lib/billing/llm-usage'
import { generateProjectAgentContextCheckpoint } from './checkpoint-generator'
import {
  buildProjectAgentContextCheckpointItem,
  projectProjectAgentActiveContext,
} from './checkpoint'

export type ProjectAgentContextCompaction = {
  readonly historyItems: readonly AgentInputItem[]
  readonly activeItems: readonly AgentInputItem[]
  readonly compacted: {
    readonly replacedItemCount: number
  } | null
  readonly usage: LlmUsageFact | null
}

export const PROJECT_AGENT_CONTEXT_COMPACTION_DEADLINE_MS = 60_000

export class ProjectAgentContextCompactionDeadlineExceededError extends AppError {
  constructor(timeoutMs: number) {
    super('GENERATION_TIMEOUT', 'PROJECT_AGENT_CONTEXT_COMPACTION_TIMEOUT', {
      details: {
        stage: 'assistant.context.compress',
        timeoutMs,
      },
    })
    this.name = 'ProjectAgentContextCompactionDeadlineExceededError'
  }
}

/**
 * Context compression is one bounded action. A provider that does not settle
 * must not hold the parent Run indefinitely.
 */
export async function runProjectAgentContextCompactionWithinDeadline<T>(input: {
  readonly deadlineMs?: number
  readonly signal?: AbortSignal
  readonly run: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const deadlineMs = input.deadlineMs ?? PROJECT_AGENT_CONTEXT_COMPACTION_DEADLINE_MS
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error('PROJECT_AGENT_CONTEXT_COMPACTION_DEADLINE_INVALID')
  }
  if (input.signal?.aborted) input.signal.throwIfAborted()

  const deadlineController = new AbortController()
  const signal = input.signal
    ? AbortSignal.any([input.signal, deadlineController.signal])
    : deadlineController.signal
  const deadlineError = new ProjectAgentContextCompactionDeadlineExceededError(deadlineMs)
  let timeout: ReturnType<typeof setTimeout> | null = null
  let rejectAbort: ((reason: unknown) => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = (): void => {
    rejectAbort?.(signal.reason ?? new Error('PROJECT_AGENT_CONTEXT_COMPACTION_ABORTED'))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  timeout = setTimeout(() => {
    deadlineController.abort(deadlineError)
  }, deadlineMs)
  timeout.unref()

  try {
    return await Promise.race([input.run(signal), aborted])
  } finally {
    if (timeout) clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Appends one checkpoint after the exact raw Session history. The model-input
 * projector activates only the latest checkpoint, while the settlement keeps
 * the original items durable in the same canonical Session.
 */
export async function compressProjectAgentContext(input: {
  session: {
    getItems(): Promise<AgentInputItem[]>
    replaceItems(items: readonly AgentInputItem[]): Promise<void>
  }
  inputItems: readonly AgentInputItem[]
  userId: string
  signal?: AbortSignal
}): Promise<ProjectAgentContextCompaction> {
  const historyItems = await input.session.getItems()
  const activeItems = projectProjectAgentActiveContext(input.inputItems)
  if (activeItems.length === 0) {
    return { historyItems, activeItems, compacted: null, usage: null }
  }

  const checkpoint = await runProjectAgentContextCompactionWithinDeadline({
    ...(input.signal ? { signal: input.signal } : {}),
    run: async (signal) =>
      await generateProjectAgentContextCheckpoint({
        userId: input.userId,
        items: activeItems,
        signal,
      }),
  })
  const checkpointItem = buildProjectAgentContextCheckpointItem(checkpoint.checkpoint)
  const compactedHistory = [...historyItems, checkpointItem]
  await input.session.replaceItems(compactedHistory)
  return {
    historyItems: compactedHistory,
    activeItems: [checkpointItem],
    compacted: {
      replacedItemCount: activeItems.length,
    },
    usage: checkpoint.usage,
  }
}
