import type { UIMessage } from 'ai'

const VISIBLE_WORKSPACE_ASSISTANT_DATA_PART_TYPES = new Set<string>([
  'data-agent-activity',
  'data-agent-interruption',
  'data-agent-stop',
  'data-assistant-choice-card',
  'data-edit-style-preview-generation',
  'data-project-phase',
  'data-project-context',
  'data-task-submitted',
  'data-task-batch-submitted',
])

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

function hasToolOutput(part: unknown): boolean {
  const type = readPartType(part)
  if (!type) return false
  return type === 'dynamic-tool' || type.startsWith('tool-')
}

function hasDataOutput(part: unknown): boolean {
  const type = readPartType(part)
  return !!type && VISIBLE_WORKSPACE_ASSISTANT_DATA_PART_TYPES.has(type)
}

export function hasWorkspaceAssistantVisibleOutput(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false
  return message.parts.some((part) => (
    hasTextOutput(part)
      || hasToolOutput(part)
      || hasDataOutput(part)
  ))
}

export function hasWorkspaceAssistantVisibleOutputAtOrAfterMessageIndex(
  messages: readonly UIMessage[],
  messageIndex: number,
): boolean {
  return messages
    .slice(Math.max(0, messageIndex))
    .some((message) => hasWorkspaceAssistantVisibleOutput(message))
}
