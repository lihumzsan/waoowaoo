'use client'

import type { UIMessage } from 'ai'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'

export function mergeWorkspaceAssistantPersistedMessages(
  currentMessages: readonly UIMessage[],
  persistedMessages: readonly UIMessage[],
): UIMessage[] {
  const normalizedPersistedMessages = ensureUniqueUIMessages([...persistedMessages])
  const persistedMessageIds = new Set(normalizedPersistedMessages.map((message) => message.id))
  return ensureUniqueUIMessages(currentMessages.length > 0
    ? [
        ...normalizedPersistedMessages,
        ...currentMessages.filter((message) => !persistedMessageIds.has(message.id)),
      ]
    : normalizedPersistedMessages)
}

export function areWorkspaceAssistantMessagesEqual(
  left: readonly UIMessage[],
  right: readonly UIMessage[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((message, index) => (
    JSON.stringify(message) === JSON.stringify(right[index])
  ))
}
