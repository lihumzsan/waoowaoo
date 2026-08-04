'use client'

export const WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT = 'workspace-assistant:send-message' as const

export interface WorkspaceAssistantSendMessagePayload {
  readonly key: string
  readonly message: string
  readonly hidden?: boolean
}

const consumedWorkspaceAssistantMessageKeys = new Set<string>()
const MAX_CONSUMED_WORKSPACE_ASSISTANT_MESSAGE_KEYS = 512

function trimConsumedKeys(keys: Set<string>): void {
  while (keys.size > MAX_CONSUMED_WORKSPACE_ASSISTANT_MESSAGE_KEYS) {
    const oldest = keys.values().next().value as string | undefined
    if (!oldest) return
    keys.delete(oldest)
  }
}

export function reserveWorkspaceAssistantMessageKey(
  key: string,
  localConsumedKeys: Set<string>,
): string | null {
  const normalizedKey = key.trim()
  if (!normalizedKey) return null
  if (localConsumedKeys.has(normalizedKey) || consumedWorkspaceAssistantMessageKeys.has(normalizedKey)) {
    return null
  }
  localConsumedKeys.add(normalizedKey)
  consumedWorkspaceAssistantMessageKeys.add(normalizedKey)
  trimConsumedKeys(localConsumedKeys)
  trimConsumedKeys(consumedWorkspaceAssistantMessageKeys)
  return normalizedKey
}

export function releaseWorkspaceAssistantMessageKey(
  key: string,
  localConsumedKeys: Set<string>,
) {
  localConsumedKeys.delete(key)
  consumedWorkspaceAssistantMessageKeys.delete(key)
}

export function dispatchWorkspaceAssistantMessage(payload: WorkspaceAssistantSendMessagePayload) {
  window.dispatchEvent(new CustomEvent<WorkspaceAssistantSendMessagePayload>(
    WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT,
    { detail: payload },
  ))
}

export function isWorkspaceAssistantSendMessageEvent(
  event: Event,
): event is CustomEvent<WorkspaceAssistantSendMessagePayload> {
  if (!(event instanceof CustomEvent)) return false
  const detail = event.detail as unknown
  if (!detail || typeof detail !== 'object') return false
  const record = detail as Partial<Record<keyof WorkspaceAssistantSendMessagePayload, unknown>>
  return typeof record.key === 'string'
    && record.key.trim().length > 0
    && typeof record.message === 'string'
    && record.message.trim().length > 0
}
