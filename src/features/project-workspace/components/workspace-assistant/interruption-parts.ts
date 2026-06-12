'use client'

import type { UIMessage } from 'ai'

/**
 * Display-only parsing of interruption data parts streamed by the server.
 * The authoritative interruption state lives server-side; these helpers exist
 * solely to decide what to render (which approval card is still open).
 */

export interface WorkspaceAssistantPendingInterruption {
  interruptionId: string
  approvalId: string
  operationId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readInterruptionPart(part: unknown): WorkspaceAssistantPendingInterruption | null {
  if (!isRecord(part) || part.type !== 'data-agent-interruption') return null
  const data = isRecord(part.data) ? part.data : null
  if (!data) return null
  const interruptionId = readNonEmptyString(data.interruptionId)
  const approvalId = readNonEmptyString(data.approvalId)
  const operationId = readNonEmptyString(data.operationId)
  if (!interruptionId || !approvalId || !operationId) return null
  return {
    interruptionId,
    approvalId,
    operationId,
  }
}

export function collectResolvedInterruptionApprovalIds(
  messages: readonly UIMessage[],
): ReadonlySet<string> {
  const resolved = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts as readonly unknown[]) {
      if (!isRecord(part) || part.type !== 'data-agent-interruption-resolved') continue
      const data = isRecord(part.data) ? part.data : null
      const approvalId = readNonEmptyString(data?.approvalId)
      if (approvalId) resolved.add(approvalId)
    }
  }
  return resolved
}

export function findPendingWorkspaceAssistantInterruption(
  messages: readonly UIMessage[],
): WorkspaceAssistantPendingInterruption | null {
  const resolvedApprovalIds = collectResolvedInterruptionApprovalIds(messages)
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const interruption = readInterruptionPart(message.parts[partIndex])
      if (!interruption) continue
      if (resolvedApprovalIds.has(interruption.approvalId)) return null
      return interruption
    }
  }
  return null
}

export function findPendingToolApprovalId(messages: readonly UIMessage[]): string | null {
  return findPendingWorkspaceAssistantInterruption(messages)?.approvalId ?? null
}
