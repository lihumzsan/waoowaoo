'use client'

import type { UIMessage } from 'ai'
import type {
  ConfirmationRequestPartData,
} from '@/lib/project-agent/types'

export interface PendingConfirmationAction {
  messageId: string
  operationId: string
  data: ConfirmationRequestPartData
}

function isConfirmationRequestPart(
  part: unknown,
): part is { type: 'data-confirmation-request'; data: ConfirmationRequestPartData } {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return false
  const record = part as Record<string, unknown>
  if (record.type !== 'data-confirmation-request') return false
  if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) return false
  const data = record.data as Record<string, unknown>
  const toolCallId = data.toolCallId
  const approvalId = data.approvalId
  return typeof data.operationId === 'string'
    && typeof approvalId === 'string'
    && typeof data.summary === 'string'
    && (toolCallId === undefined || toolCallId === null || typeof toolCallId === 'string')
}

function readToolCallIdFromPart(part: unknown): string | null {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return null
  const record = part as Record<string, unknown>
  const toolCallId = record.toolCallId
  return typeof toolCallId === 'string' && toolCallId.trim() ? toolCallId.trim() : null
}

function isCompletedToolOutputPart(part: unknown): boolean {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return false
  const record = part as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  if (type !== 'dynamic-tool' && !type.startsWith('tool-')) return false
  return record.state === 'output-available' || record.state === 'output-error'
}

function hasCompletedToolOutputForConfirmation(
  message: UIMessage,
  confirmation: ConfirmationRequestPartData,
): boolean {
  const toolCallId = typeof confirmation.toolCallId === 'string' ? confirmation.toolCallId.trim() : ''
  if (!toolCallId) return false
  return message.parts.some((part) => (
    readToolCallIdFromPart(part) === toolCallId && isCompletedToolOutputPart(part)
  ))
}

export function collectPendingConfirmationActions(messages: UIMessage[]): PendingConfirmationAction[] {
  const actions: PendingConfirmationAction[] = []

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isConfirmationRequestPart(part)) continue
      if (typeof part.data.toolCallId !== 'string' || !part.data.toolCallId.trim()) continue
      if (hasCompletedToolOutputForConfirmation(message, part.data)) continue
      actions.push({
        messageId: message.id,
        operationId: part.data.operationId,
        data: part.data,
      })
    }
  }

  return actions
}

export function removeConfirmationRequestFromMessages(messages: UIMessage[], operationId: string): UIMessage[] {
  return messages.flatMap((message) => {
    const nextParts = message.parts.filter((part) => (
      !isConfirmationRequestPart(part) || part.data.operationId !== operationId
    ))
    if (nextParts.length === 0) return []
    return [{ ...message, parts: nextParts }]
  })
}
