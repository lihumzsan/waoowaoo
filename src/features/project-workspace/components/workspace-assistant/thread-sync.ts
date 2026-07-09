'use client'

import type { UIMessage } from 'ai'
import type { ProjectAgentSessionRun } from '@/lib/project-agent/session-state'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'

export type WorkspaceAssistantThreadSyncRun = Pick<ProjectAgentSessionRun, 'runId' | 'status'>

export const WORKSPACE_ASSISTANT_THREAD_CATCH_UP_DELAYS_MS = [0, 300, 1000, 2500] as const

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

export function shouldRefetchWorkspaceAssistantThreadForRunTransition(input: {
  previousRun: WorkspaceAssistantThreadSyncRun | null
  currentRun: WorkspaceAssistantThreadSyncRun | null
}): boolean {
  if (!input.previousRun) return Boolean(input.currentRun)
  if (!input.currentRun) return true
  return input.previousRun.runId !== input.currentRun.runId
    || input.previousRun.status !== input.currentRun.status
}
