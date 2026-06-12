import type { UIMessage } from 'ai'
import type {
  ProjectAgentApprovalResponseData,
  ProjectAgentInterruptionPartData,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function findPendingToolApprovalId(messages: readonly UIMessage[]): string | null {
  const interruption = findPendingAgentInterruption(messages)
  if (interruption) return interruption.approvalId

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

function parseInterruptionData(value: unknown): ProjectAgentInterruptionPartData | null {
  if (!isRecord(value)) return null
  const approvalId = value.approvalId
  const operationId = value.operationId
  const runState = value.runState
  const requestId = value.requestId
  const display = value.display
  if (
    typeof approvalId !== 'string'
    || typeof operationId !== 'string'
    || typeof runState !== 'string'
    || typeof requestId !== 'string'
    || !isRecord(display)
  ) {
    return null
  }
  const title = display.title
  const description = display.description
  if (typeof title !== 'string' || typeof description !== 'string') return null
  const toolCallId = value.toolCallId
  return {
    requestId,
    approvalId,
    operationId,
    runState,
    toolCallId: typeof toolCallId === 'string' ? toolCallId : null,
    display: {
      title,
      description,
    },
  }
}

export function findPendingAgentInterruption(
  messages: readonly UIMessage[],
  approvalId?: string | null,
): ProjectAgentInterruptionPartData | null {
  const normalizedApprovalId = typeof approvalId === 'string' ? approvalId.trim() : ''
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex] as unknown
      if (!isRecord(part)) continue
      if (part.type !== 'data-agent-interruption') continue
      const data = parseInterruptionData(part.data)
      if (!data) continue
      if (normalizedApprovalId && data.approvalId !== normalizedApprovalId) continue
      return data
    }
  }
  return null
}

function parseApprovalResponseData(value: unknown): ProjectAgentApprovalResponseData | null {
  if (!isRecord(value)) return null
  const approvalId = value.approvalId
  const approved = value.approved
  const runState = value.runState
  if (typeof approvalId !== 'string' || typeof approved !== 'boolean' || typeof runState !== 'string') {
    return null
  }
  const reason = value.reason
  return {
    approvalId,
    approved,
    runState,
    reason: typeof reason === 'string' ? reason : null,
  }
}

export function findLatestProjectAgentApprovalResponse(
  messages: readonly UIMessage[],
): ProjectAgentApprovalResponseData | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'user') continue
    const metadata = message.metadata
    if (!isRecord(metadata)) continue
    const custom = metadata.custom
    if (!isRecord(custom)) continue
    const response = parseApprovalResponseData(custom.projectAgentApprovalResponse)
    if (response) return response
  }
  return null
}
