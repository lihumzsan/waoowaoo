import { randomUUID } from 'node:crypto'
import type { UIMessageChunk } from 'ai'
import { createScopedLogger } from '@/lib/logging/core'
import { redis } from '@/lib/redis'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type AgentSessionViewChangedSSEEvent,
  type AgentTurnStreamSSEEvent,
} from '@/lib/sse/events'
import { getProjectChannel } from '@/lib/task/publisher'

const AGENT_TURN_STREAM_MAX_PENDING_EVENTS = 256
const AGENT_TURN_STREAM_MAX_EVENT_BYTES = 256 * 1_024

const logger = createScopedLogger({ module: 'agent-turn.stream-publisher' })

export function buildAgentTurnAssistantMessageId(params: {
  turnId: string
  attempt: number
  segment?: number
}): string {
  if (!params.turnId || params.turnId !== params.turnId.trim()) {
    throw new Error('AGENT_TURN_STREAM_TURN_ID_INVALID')
  }
  if (!Number.isSafeInteger(params.attempt) || params.attempt <= 0) {
    throw new Error('AGENT_TURN_STREAM_ATTEMPT_INVALID')
  }
  const segment = params.segment ?? 0
  if (!Number.isSafeInteger(segment) || segment < 0) {
    throw new Error('AGENT_TURN_STREAM_SEGMENT_INVALID')
  }
  const base = `workspace-assistant-turn:${params.turnId}:attempt:${String(params.attempt)}`
  return segment === 0 ? base : `${base}:segment:${String(segment)}`
}

export interface AgentTurnStreamPublisher {
  reserve: (chunk: UIMessageChunk) => number | null
  setMessageId: (messageId: string) => void
  sealThrough: (watermark: number) => void
  publishThrough: (watermark: number) => Promise<void>
  flush: () => Promise<void>
}

function mergeAdjacentDeltaChunks(
  previous: UIMessageChunk,
  next: UIMessageChunk,
): UIMessageChunk | null {
  if (
    previous.type === 'text-delta'
    && next.type === 'text-delta'
    && previous.id === next.id
  ) {
    return { ...previous, delta: `${previous.delta}${next.delta}` }
  }
  if (
    previous.type === 'reasoning-delta'
    && next.type === 'reasoning-delta'
    && previous.id === next.id
  ) {
    return { ...previous, delta: `${previous.delta}${next.delta}` }
  }
  return null
}

export function createAgentTurnStreamPublisher(params: {
  projectId: string
  userId: string
  threadId: string
  turnId: string
  attempt: number
  messageId: string
}): AgentTurnStreamPublisher {
  let nextSeq = 0
  let sealedThrough = 0
  let currentMessageId = params.messageId
  const bufferedEvents = new Map<number, AgentTurnStreamSSEEvent>()
  let disabled = false
  let tail = Promise.resolve()

  const disable = (reason: string, error?: unknown): void => {
    if (disabled) return
    disabled = true
    bufferedEvents.clear()
    logger.warn({
      action: 'agent_turn.stream.disabled',
      message: 'agent turn ephemeral stream disabled',
      projectId: params.projectId,
      userId: params.userId,
      details: {
        threadId: params.threadId,
        turnId: params.turnId,
        attempt: params.attempt,
        reason,
        ...(error instanceof Error
          ? { errorName: error.name, errorMessage: error.message }
          : {}),
      },
    })
  }

  return {
    reserve(chunk) {
      if (disabled) return null
      const previous = bufferedEvents.get(nextSeq)
      if (
        nextSeq > sealedThrough
        && previous?.messageId === currentMessageId
      ) {
        const mergedChunk = mergeAdjacentDeltaChunks(previous.chunk, chunk)
        if (mergedChunk) {
          const mergedEvent: AgentTurnStreamSSEEvent = {
            ...previous,
            chunk: mergedChunk,
          }
          if (
            Buffer.byteLength(JSON.stringify(mergedEvent), 'utf8')
            <= AGENT_TURN_STREAM_MAX_EVENT_BYTES
          ) {
            bufferedEvents.set(nextSeq, mergedEvent)
            return nextSeq
          }
        }
      }
      if (bufferedEvents.size >= AGENT_TURN_STREAM_MAX_PENDING_EVENTS) {
        disable('pending_event_limit')
        return null
      }
      const seq = nextSeq + 1
      const event: AgentTurnStreamSSEEvent = {
        protocol: 'agent_turn_stream_v1',
        id: `turn:${params.turnId}:${String(params.attempt)}:ui:${String(seq)}`,
        type: WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM,
        projectId: params.projectId,
        userId: params.userId,
        assistantId: 'workspace-command',
        threadId: params.threadId,
        turnId: params.turnId,
        attempt: params.attempt,
        lane: 'ui',
        seq,
        messageId: currentMessageId,
        chunk,
        ts: new Date().toISOString(),
      }
      const message = JSON.stringify(event)
      if (
        Buffer.byteLength(message, 'utf8')
        > AGENT_TURN_STREAM_MAX_EVENT_BYTES
      ) {
        disable('event_byte_limit')
        return null
      }
      nextSeq = seq
      bufferedEvents.set(seq, event)
      return seq
    },
    setMessageId(messageId) {
      if (!messageId || messageId !== messageId.trim()) {
        throw new Error('AGENT_TURN_STREAM_MESSAGE_ID_INVALID')
      }
      currentMessageId = messageId
    },
    sealThrough(watermark) {
      if (disabled) return
      if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > nextSeq) {
        throw new Error('AGENT_TURN_STREAM_WATERMARK_INVALID')
      }
      sealedThrough = Math.max(sealedThrough, watermark)
    },
    async publishThrough(watermark) {
      if (disabled) return
      if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > nextSeq) {
        throw new Error('AGENT_TURN_STREAM_WATERMARK_INVALID')
      }
      if (watermark > sealedThrough) {
        throw new Error('AGENT_TURN_STREAM_WATERMARK_UNSEALED')
      }
      const messages = [...bufferedEvents.entries()]
        .filter(([seq]) => seq <= watermark)
        .sort(([left], [right]) => left - right)
        .map(([seq, event]) => [seq, JSON.stringify(event)] as const)
      for (const [seq] of messages) bufferedEvents.delete(seq)
      tail = tail
        .then(async () => {
          if (disabled) return
          for (const [, message] of messages) {
            await redis.publish(getProjectChannel(params.projectId), message)
          }
        })
        .catch((error: unknown) => {
          disable('redis_publish_failed', error)
        })
      await tail
    },
    async flush() {
      await tail
      if (!disabled && bufferedEvents.size > 0) {
        throw new Error('AGENT_TURN_STREAM_UNCOMMITTED_EVENTS')
      }
    },
  }
}

export async function publishAgentSessionViewChanged(params: {
  projectId: string
  userId: string
  threadId: string
  turnId: string | null
  attempt: number | null
  reason: string
}): Promise<void> {
  try {
    const event: AgentSessionViewChangedSSEEvent = {
      protocol: 'agent_session_view_changed_v1',
      id: `agent-view:${randomUUID()}`,
      type: WORKSPACE_SSE_EVENT_TYPE.AGENT_SESSION_VIEW_CHANGED,
      projectId: params.projectId,
      userId: params.userId,
      assistantId: 'workspace-command',
      threadId: params.threadId,
      turnId: params.turnId,
      attempt: params.attempt,
      reason: params.reason,
      ts: new Date().toISOString(),
    }
    await redis.publish(
      getProjectChannel(params.projectId),
      JSON.stringify(event),
    )
  } catch (error) {
    logger.warn({
      action: 'agent_turn.view_invalidation_failed',
      message: 'agent session view invalidation publish failed',
      projectId: params.projectId,
      userId: params.userId,
      details: {
        threadId: params.threadId,
        turnId: params.turnId,
        attempt: params.attempt,
        reason: params.reason,
        ...(error instanceof Error
          ? { errorName: error.name, errorMessage: error.message }
          : {}),
      },
    })
  }
}
