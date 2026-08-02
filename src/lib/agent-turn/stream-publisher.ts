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
}): string {
  if (!params.turnId || params.turnId !== params.turnId.trim()) {
    throw new Error('AGENT_TURN_STREAM_TURN_ID_INVALID')
  }
  if (!Number.isSafeInteger(params.attempt) || params.attempt <= 0) {
    throw new Error('AGENT_TURN_STREAM_ATTEMPT_INVALID')
  }
  return `workspace-assistant-turn:${params.turnId}:attempt:${String(params.attempt)}`
}

export interface AgentTurnStreamPublisher {
  publish: (chunk: UIMessageChunk) => void
  flush: () => Promise<void>
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
  let pendingEvents = 0
  let disabled = false
  let tail = Promise.resolve()

  const disable = (reason: string, error?: unknown): void => {
    if (disabled) return
    disabled = true
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
    publish(chunk) {
      if (disabled) return
      if (pendingEvents >= AGENT_TURN_STREAM_MAX_PENDING_EVENTS) {
        disable('pending_event_limit')
        return
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
        messageId: params.messageId,
        chunk,
        ts: new Date().toISOString(),
      }
      const message = JSON.stringify(event)
      if (
        Buffer.byteLength(message, 'utf8')
        > AGENT_TURN_STREAM_MAX_EVENT_BYTES
      ) {
        disable('event_byte_limit')
        return
      }
      nextSeq = seq
      pendingEvents += 1
      tail = tail
        .then(async () => {
          if (disabled) return
          await redis.publish(getProjectChannel(params.projectId), message)
        })
        .catch((error: unknown) => {
          disable('redis_publish_failed', error)
        })
        .finally(() => {
          pendingEvents -= 1
        })
    },
    async flush() {
      await tail
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
