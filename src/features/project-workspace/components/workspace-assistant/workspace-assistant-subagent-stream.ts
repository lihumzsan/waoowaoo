import {
  TASK_SSE_EVENT_TYPE,
  TASK_TYPE,
  type SSEEvent,
} from '@/lib/task/types'

export type WorkspaceAssistantSubagentReasoningStream = {
  taskId: string
  reasoningId: string
  streamRunId: string
  lastSeq: number
  text: string
  occurredAt: string
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

export type SubagentReasoningStreamReduction =
  | { kind: 'unchanged'; streams: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream> }
  | { kind: 'updated'; streams: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream> }
  | {
    kind: 'gap'
    streams: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream>
    taskId: string
    streamIdentity: string
  }
  | {
    kind: 'unknown_task'
    streams: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream>
    taskId: string
  }

export interface WorkspaceAssistantSubagentReasoningStreamPolicy {
  readonly ownedTaskIds?: ReadonlySet<string>
  readonly invalidatedStreamIdentities?: ReadonlySet<string>
}

export function isWorkspaceAssistantSessionSubagentTask(
  ownedTaskIds: ReadonlySet<string>,
  taskId: string,
): boolean {
  return ownedTaskIds.has(taskId)
}

export function resolveWorkspaceAssistantSubagentTaskEventDisposition(params: {
  readonly ownedTaskIds: ReadonlySet<string>
  readonly ownershipRequestedTaskIds: ReadonlySet<string>
  readonly taskId: string
}): 'accept' | 'confirm' | 'ignore' {
  if (isWorkspaceAssistantSessionSubagentTask(params.ownedTaskIds, params.taskId)) {
    return 'accept'
  }
  return params.ownershipRequestedTaskIds.has(params.taskId) ? 'ignore' : 'confirm'
}

export function reduceWorkspaceAssistantSubagentReasoningStream(
  current: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream>,
  event: SSEEvent,
  policy: WorkspaceAssistantSubagentReasoningStreamPolicy = {},
): SubagentReasoningStreamReduction {
  if (
    event.type !== TASK_SSE_EVENT_TYPE.STREAM
    || event.taskType !== TASK_TYPE.CREATIVE_WORK
  ) return { kind: 'unchanged', streams: current }
  if (
    policy.ownedTaskIds
    && !isWorkspaceAssistantSessionSubagentTask(policy.ownedTaskIds, event.taskId)
  ) {
    return { kind: 'unknown_task', streams: current, taskId: event.taskId }
  }
  const payload = readRecord(event.payload)
  const stream = readRecord(payload.stream)
  if (readString(stream.kind) !== 'reasoning') {
    return { kind: 'unchanged', streams: current }
  }
  const delta = readString(stream.delta)
  const reasoningId = readString(payload.stepId)
  const streamRunId = readString(payload.streamRunId)
  const seq = readPositiveInteger(stream.seq)
  if (!delta || !reasoningId || !streamRunId || !seq) {
    return { kind: 'unchanged', streams: current }
  }
  const key = `${event.taskId}|${streamRunId}|${reasoningId}`
  if (policy.invalidatedStreamIdentities?.has(key)) {
    return { kind: 'unchanged', streams: current }
  }
  const previous = current.get(key)
  if (previous && seq <= previous.lastSeq) {
    return { kind: 'unchanged', streams: current }
  }
  if (previous && seq !== previous.lastSeq + 1) {
    const next = new Map(current)
    next.delete(key)
    return {
      kind: 'gap',
      streams: next,
      taskId: event.taskId,
      streamIdentity: key,
    }
  }
  if (!previous && seq !== 1) {
    return {
      kind: 'gap',
      streams: current,
      taskId: event.taskId,
      streamIdentity: key,
    }
  }
  const next = new Map(current)
  next.set(key, {
    taskId: event.taskId,
    reasoningId,
    streamRunId,
    lastSeq: seq,
    text: `${previous?.text ?? ''}${delta}`,
    occurredAt: previous?.occurredAt ?? event.ts,
  })
  return { kind: 'updated', streams: next }
}

export function removeWorkspaceAssistantSubagentReasoningStreams(
  current: ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream>,
  taskId: string,
): ReadonlyMap<string, WorkspaceAssistantSubagentReasoningStream> {
  const next = new Map(current)
  for (const [key, stream] of next) {
    if (stream.taskId === taskId) next.delete(key)
  }
  return next
}
