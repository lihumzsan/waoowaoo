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

export function resolveWorkspaceAssistantThreadSnapshotMessages(
  currentMessages: readonly UIMessage[],
  persistedThread: { readonly id?: string; readonly messages: readonly UIMessage[] } | null,
  acceptedThreadId: string | null = null,
): UIMessage[] {
  if (!persistedThread) return []
  if (persistedThread.id && acceptedThreadId && persistedThread.id !== acceptedThreadId) {
    return ensureUniqueUIMessages([...persistedThread.messages])
  }
  return mergeWorkspaceAssistantPersistedMessages(currentMessages, persistedThread.messages)
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
