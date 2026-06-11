import type { UIMessage } from 'ai'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function findPendingToolApprovalId(messages: readonly UIMessage[]): string | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex] as unknown
      if (!isRecord(part)) continue
      if (part.state !== 'approval-requested') continue
      const approval = isRecord(part.approval) ? part.approval : null
      const id = approval?.id
      if (typeof id === 'string' && id.trim().length > 0) return id.trim()
    }
  }
  return null
}
