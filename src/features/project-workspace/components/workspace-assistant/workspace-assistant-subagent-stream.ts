import {
  TASK_SSE_EVENT_TYPE,
  TASK_TYPE,
  type SSEEvent,
} from '@/lib/task/types'

export type WorkspaceAssistantSubagentLiveStream = {
  kind: 'reasoning' | 'structured_output'
  taskId: string
  streamId: string
  streamRunId: string
  stepAttempt: number
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

export type SubagentLiveStreamReduction =
  | { kind: 'unchanged'; streams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream> }
  | { kind: 'updated'; streams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream> }
  | {
    kind: 'gap'
    streams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>
    taskId: string
    streamIdentity: string
  }
  | {
    kind: 'unknown_task'
    streams: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>
    taskId: string
  }

export interface WorkspaceAssistantSubagentLiveStreamPolicy {
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

export function reduceWorkspaceAssistantSubagentLiveStream(
  current: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>,
  event: SSEEvent,
  policy: WorkspaceAssistantSubagentLiveStreamPolicy = {},
): SubagentLiveStreamReduction {
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
  const streamKind = readString(stream.kind)
  const lane = readString(stream.lane)
  const kind = streamKind === 'reasoning'
    ? 'reasoning' as const
    : streamKind === 'text' && lane === 'structured-output'
      ? 'structured_output' as const
      : null
  if (!kind) {
    return { kind: 'unchanged', streams: current }
  }
  const delta = typeof stream.delta === 'string' && stream.delta.length > 0
    ? stream.delta
    : null
  const streamId = readString(payload.stepId)
  const streamRunId = readString(payload.streamRunId)
  const stepAttempt = readPositiveInteger(payload.stepAttempt)
  const seq = readPositiveInteger(stream.seq)
  if (!delta || !streamId || !streamRunId || !stepAttempt || !seq) {
    return { kind: 'unchanged', streams: current }
  }
  const key = `${event.taskId}|${streamRunId}|${kind}|${streamId}`
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
    kind,
    taskId: event.taskId,
    streamId,
    streamRunId,
    stepAttempt,
    lastSeq: seq,
    text: `${previous?.text ?? ''}${delta}`,
    occurredAt: previous?.occurredAt ?? event.ts,
  })
  return { kind: 'updated', streams: next }
}

export function removeWorkspaceAssistantSubagentLiveStreams(
  current: ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream>,
  taskId: string,
): ReadonlyMap<string, WorkspaceAssistantSubagentLiveStream> {
  const next = new Map(current)
  for (const [key, stream] of next) {
    if (stream.taskId === taskId) next.delete(key)
  }
  return next
}
