import type { UIMessage } from 'ai'
import { readProjectAssistantMediaAttachmentsFromMessage } from '@/lib/project-agent/media-attachments'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export interface AgentTurnUserEvidence {
  readonly text: string | null
  readonly mediaResourceIds: readonly string[]
}

/**
 * Derives tool-visible evidence from the exact server-validated user message
 * stored on this Turn. It is intentionally not copied into contextJson:
 * derived turns have no user message and therefore cannot inherit stale text
 * or attachment authority from an earlier Turn.
 */
export function deriveAgentTurnUserEvidence(
  message: UIMessage | null,
): AgentTurnUserEvidence {
  if (!message) return { text: null, mediaResourceIds: [] }
  if (message.role !== 'user') {
    throw new Error('AGENT_TURN_USER_MESSAGE_ROLE_INVALID')
  }
  const text = message.parts.flatMap((part) => {
    if (!isRecord(part) || part.type !== 'text') return []
    return typeof part.text === 'string' && part.text.trim()
      ? [part.text]
      : []
  }).join('\n')
  return {
    text: text || null,
    mediaResourceIds: readProjectAssistantMediaAttachmentsFromMessage(
      message,
    ).map((attachment) => attachment.resourceId),
  }
}
