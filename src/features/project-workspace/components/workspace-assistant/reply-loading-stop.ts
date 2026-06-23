import type { UIMessage } from 'ai'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readPartType(part: unknown): string | null {
  if (!isRecord(part)) return null
  const type = part.type
  return typeof type === 'string' && type.trim() ? type : null
}

function hasTextOutput(part: unknown): boolean {
  if (!isRecord(part)) return false
  const type = readPartType(part)
  if (type !== 'text' && type !== 'reasoning') return false
  const text = part.text
  return typeof text === 'string' && text.trim().length > 0
}

function hasControlYieldOutput(part: unknown): boolean {
  if (!isRecord(part)) return false
  const type = readPartType(part)
  if (type === 'data-assistant-choice-card' || type === 'data-agent-interruption') return true
  if (type === 'data-agent-stop') return true
  if (type !== 'data-agent-activity') return false
  const data = isRecord(part.data) ? part.data : null
  if (!data || data.status !== 'waiting') return false
  return data.type === 'awaiting_choice'
    || data.type === 'awaiting_approval'
    || data.type === 'waiting_task'
}

export function hasWorkspaceAssistantTextOutput(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false
  return message.parts.some((part) => hasTextOutput(part))
}

export function hasWorkspaceAssistantReplyLoadingStop(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false
  return message.parts.some((part) => hasTextOutput(part) || hasControlYieldOutput(part))
}

export function hasWorkspaceAssistantReplyLoadingStopAtOrAfterMessageIndex(
  messages: readonly UIMessage[],
  messageIndex: number,
): boolean {
  return messages
    .slice(Math.max(0, messageIndex))
    .some((message) => hasWorkspaceAssistantReplyLoadingStop(message))
}
