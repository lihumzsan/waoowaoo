import { createHash } from 'node:crypto'
import { findStructuredStreamAdapters } from '@/lib/structured-stream/workspace-structured-stream-adapters'
import {
  TASK_SSE_EVENT_TYPE,
  isTaskTerminalEventType,
  type TaskSSEEvent,
} from './types'

export const TASK_STRUCTURED_STREAM_CHECKPOINT_EVENT_TYPE = 'task.stream_checkpoint'

export interface TaskStructuredStreamCheckpointWrite {
  readonly fullDelta: string
  readonly throughSeq: number
}

interface StructuredStreamCheckpointMetadata {
  readonly fromSeq: 1
  readonly throughSeq: number
  readonly checkpointedAt: string
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function readCheckpointMetadata(payload: Record<string, unknown>): StructuredStreamCheckpointMetadata | null {
  const checkpoint = readRecord(payload.streamCheckpoint)
  const fromSeq = readPositiveInteger(checkpoint.fromSeq)
  const throughSeq = readPositiveInteger(checkpoint.throughSeq)
  const checkpointedAt = readString(checkpoint.checkpointedAt)
  if (fromSeq !== 1 || !throughSeq || !checkpointedAt) return null
  if (!Number.isFinite(Date.parse(checkpointedAt))) return null
  return { fromSeq: 1, throughSeq, checkpointedAt }
}

function checkpointIdentityKey(input: {
  readonly taskId: string
  readonly streamRunId: string
  readonly stepId: string
  readonly stepAttempt: number
  readonly lane: string
  readonly kind: string
}): string {
  const digest = createHash('sha256')
    .update([
      input.taskId,
      input.streamRunId,
      input.stepId,
      String(input.stepAttempt),
      input.lane,
      input.kind,
    ].join('\u0000'))
    .digest('hex')
  return `task-stream-checkpoint:${input.taskId}:${digest}`
}

export function buildTaskStructuredStreamCheckpoint(input: {
  readonly taskId: string
  readonly taskType: string | null | undefined
  readonly payload: Record<string, unknown>
  readonly checkpoint: TaskStructuredStreamCheckpointWrite
  readonly checkpointedAt: string
}): { readonly idempotencyKey: string; readonly payload: Record<string, unknown> } | null {
  const stream = readRecord(input.payload.stream)
  const kind = readString(stream.kind)
  const stepId = readString(input.payload.stepId)
  if (kind !== 'text' || !stepId) return null
  if (findStructuredStreamAdapters({ taskType: input.taskType ?? null, stepId }).length === 0) return null

  const streamRunId = readString(input.payload.streamRunId)
  const stepAttempt = readPositiveInteger(input.payload.stepAttempt)
  const seq = readPositiveInteger(stream.seq)
  const lane = readString(stream.lane) ?? 'main'
  if (!streamRunId || !stepAttempt || !seq) {
    throw new Error(`TASK_STRUCTURED_STREAM_CHECKPOINT_IDENTITY_INVALID:${input.taskId}`)
  }
  if (
    !input.checkpoint.fullDelta
    || input.checkpoint.throughSeq !== seq
    || !Number.isFinite(Date.parse(input.checkpointedAt))
  ) {
    throw new Error(`TASK_STRUCTURED_STREAM_CHECKPOINT_VERSION_INVALID:${input.taskId}`)
  }

  return {
    idempotencyKey: checkpointIdentityKey({
      taskId: input.taskId,
      streamRunId,
      stepId,
      stepAttempt,
      lane,
      kind,
    }),
    payload: {
      ...input.payload,
      stream: {
        ...stream,
        delta: input.checkpoint.fullDelta,
        seq: input.checkpoint.throughSeq,
      },
      streamCheckpoint: {
        fromSeq: 1,
        throughSeq: input.checkpoint.throughSeq,
        checkpointedAt: input.checkpointedAt,
      },
    },
  }
}

interface RecoverableCheckpointIdentity {
  readonly logicalKey: string
  readonly streamRunId: string
  readonly stepAttempt: number
  readonly throughSeq: number
  readonly checkpointedAt: string
}

function readRecoverableCheckpointIdentity(event: TaskSSEEvent): RecoverableCheckpointIdentity {
  if (event.type !== TASK_SSE_EVENT_TYPE.STREAM) {
    throw new Error(`TASK_STRUCTURED_STREAM_CHECKPOINT_EVENT_TYPE_INVALID:${event.id}`)
  }
  const payload = readRecord(event.payload)
  const stream = readRecord(payload.stream)
  const metadata = readCheckpointMetadata(payload)
  const streamRunId = readString(payload.streamRunId)
  const stepId = readString(payload.stepId)
  const stepAttempt = readPositiveInteger(payload.stepAttempt)
  const lane = readString(stream.lane) ?? 'main'
  const kind = readString(stream.kind)
  const seq = readPositiveInteger(stream.seq)
  const delta = readString(stream.delta)
  if (
    !metadata
    || !streamRunId
    || !stepId
    || !stepAttempt
    || kind !== 'text'
    || seq !== metadata.throughSeq
    || !delta
  ) {
    throw new Error(`TASK_STRUCTURED_STREAM_CHECKPOINT_PAYLOAD_INVALID:${event.taskId}:${event.id}`)
  }
  return {
    logicalKey: [event.taskId, stepId, lane, kind].join('\u0000'),
    streamRunId,
    stepAttempt,
    throughSeq: metadata.throughSeq,
    checkpointedAt: metadata.checkpointedAt,
  }
}

function isNewerCheckpoint(
  candidate: RecoverableCheckpointIdentity,
  current: RecoverableCheckpointIdentity,
): boolean {
  if (candidate.stepAttempt !== current.stepAttempt) return candidate.stepAttempt > current.stepAttempt
  if (candidate.checkpointedAt !== current.checkpointedAt) {
    return candidate.checkpointedAt > current.checkpointedAt
  }
  if (candidate.throughSeq !== current.throughSeq) return candidate.throughSeq > current.throughSeq
  return candidate.streamRunId > current.streamRunId
}

/**
 * Converts mutable TaskEvent checkpoint rows into immutable per-bootstrap SSE
 * snapshot facts. One logical step/lane keeps only its newest run/attempt.
 */
export function buildRecoverableStructuredStreamCheckpointEvents(
  events: readonly TaskSSEEvent[],
): TaskSSEEvent[] {
  const selected = new Map<string, {
    readonly event: TaskSSEEvent
    readonly identity: RecoverableCheckpointIdentity
  }>()
  for (const event of events) {
    const identity = readRecoverableCheckpointIdentity(event)
    const current = selected.get(identity.logicalKey)
    if (!current || isNewerCheckpoint(identity, current.identity)) {
      selected.set(identity.logicalKey, { event, identity })
    }
  }

  return [...selected.values()]
    .sort((left, right) => (
      left.identity.checkpointedAt.localeCompare(right.identity.checkpointedAt)
      || left.event.taskId.localeCompare(right.event.taskId)
      || left.identity.logicalKey.localeCompare(right.identity.logicalKey)
    ))
    .map(({ event, identity }) => ({
      ...event,
      id: `snapshot:stream:${event.id}:${String(identity.throughSeq)}`,
      ts: identity.checkpointedAt,
    }))
}

export function buildStructuredStreamTerminalSnapshotEvents(input: {
  readonly checkpoints: readonly TaskSSEEvent[]
  readonly terminalEvents: readonly TaskSSEEvent[]
}): TaskSSEEvent[] {
  const checkpointTaskIds = new Set(input.checkpoints.map((event) => event.taskId))
  const terminalByTaskId = new Map<string, TaskSSEEvent>()
  for (const event of input.terminalEvents) {
    const lifecycleType = readString(readRecord(event.payload).lifecycleType)
    if (!isTaskTerminalEventType(lifecycleType) || !checkpointTaskIds.has(event.taskId)) continue
    terminalByTaskId.set(event.taskId, event)
  }
  return [...terminalByTaskId.values()].map((event) => ({
    ...event,
    id: `snapshot:terminal:${event.taskId}:${event.id}`,
  }))
}
