import { Prisma } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import {
  parseProjectAssistantModelHistory,
  serializeProjectAssistantModelHistory,
} from '@/lib/project-agent/persistence'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readAgentTurnApprovalCallIds(payloads: readonly Prisma.JsonValue[]): Set<string> {
  const callIds = new Set<string>()
  for (const payload of payloads) {
    if (
      !isRecord(payload) ||
      payload.protocol !== 'agent_turn_approval_v1' ||
      !Array.isArray(payload.members) ||
      payload.members.length === 0
    ) {
      throw new Error('AGENT_TURN_APPROVAL_HISTORY_PAYLOAD_INVALID')
    }
    for (const member of payload.members) {
      if (
        !isRecord(member) ||
        typeof member.callId !== 'string' ||
        !member.callId.trim() ||
        callIds.has(member.callId)
      ) {
        throw new Error('AGENT_TURN_APPROVAL_HISTORY_CALL_ID_INVALID')
      }
      callIds.add(member.callId)
    }
  }
  return callIds
}

export function buildAgentTurnApprovalTerminalResults(params: {
  modelHistory: readonly AgentInputItem[]
  approvalCallIds: ReadonlySet<string>
  terminalMessage: string
}): AgentInputItem[] {
  const completedCallIds = new Set(
    params.modelHistory.flatMap((item) => {
      const record = item as unknown as Record<string, unknown>
      return record.type === 'function_call_result' && typeof record.callId === 'string'
        ? [record.callId]
        : []
    }),
  )
  return params.modelHistory.flatMap((item) => {
    const record = item as unknown as Record<string, unknown>
    if (
      record.type !== 'function_call' ||
      typeof record.callId !== 'string' ||
      !record.callId.trim() ||
      typeof record.name !== 'string' ||
      !record.name.trim() ||
      !params.approvalCallIds.has(record.callId) ||
      completedCallIds.has(record.callId)
    ) {
      return []
    }
    return [
      {
        type: 'function_call_result',
        callId: record.callId,
        name: record.name,
        status: 'completed',
        output: {
          type: 'text',
          text: params.terminalMessage,
        },
      } as unknown as AgentInputItem,
    ]
  })
}

/**
 * Close every frozen approval call whose SDK snapshot was already committed
 * before its resumed Turn reached a terminal state. The caller must hold the
 * repository lock order (Project -> Thread -> Turn).
 */
export async function closeAgentTurnApprovalHistoryInTransaction(params: {
  tx: Prisma.TransactionClient
  thread: {
    id: string
    modelHistoryVersion: number
    modelHistoryJson: Prisma.JsonValue
  }
  turnId: string
  terminalMessage: string
}): Promise<number> {
  const interactions = await params.tx.agentTurnInteraction.findMany({
    where: {
      turnId: params.turnId,
      kind: 'approval',
      status: { in: ['pending', 'approved', 'rejected'] },
    },
    select: { payloadJson: true },
  })
  if (interactions.length === 0) return params.thread.modelHistoryVersion

  const modelHistory = parseProjectAssistantModelHistory(params.thread.modelHistoryJson)
  const callIds = readAgentTurnApprovalCallIds(
    interactions.map((interaction) => interaction.payloadJson),
  )
  const historyFunctionCallIds = new Set<string>()
  const historyResultCallIds = new Set<string>()
  for (const item of modelHistory) {
    const record = item as unknown as Record<string, unknown>
    if (record.type === 'function_call' && typeof record.callId === 'string') {
      historyFunctionCallIds.add(record.callId)
    }
    if (record.type === 'function_call_result' && typeof record.callId === 'string') {
      historyResultCallIds.add(record.callId)
    }
  }
  const missingFunctionCalls = [...callIds].filter((callId) => !historyFunctionCallIds.has(callId))
  if (missingFunctionCalls.length > 0) {
    throw new Error(
      `AGENT_TURN_APPROVAL_HISTORY_CALL_MISSING:${params.turnId}:${missingFunctionCalls.join(',')}`,
    )
  }
  const unresolvedCallIds = new Set(
    [...callIds].filter((callId) => !historyResultCallIds.has(callId)),
  )
  if (unresolvedCallIds.size === 0) return params.thread.modelHistoryVersion
  const terminalResults = buildAgentTurnApprovalTerminalResults({
    modelHistory,
    approvalCallIds: unresolvedCallIds,
    terminalMessage: params.terminalMessage,
  })
  if (terminalResults.length !== unresolvedCallIds.size) {
    throw new Error(`AGENT_TURN_APPROVAL_HISTORY_DIVERGED:${params.turnId}`)
  }
  const updated = await params.tx.projectAssistantThread.updateMany({
    where: {
      id: params.thread.id,
      modelHistoryVersion: params.thread.modelHistoryVersion,
    },
    data: {
      modelHistoryJson: serializeProjectAssistantModelHistory([
        ...modelHistory,
        ...terminalResults,
      ]),
      modelHistoryVersion: { increment: 1 },
    },
  })
  if (updated.count !== 1) {
    throw new Error(`AGENT_TURN_APPROVAL_HISTORY_CONFLICT:${params.turnId}`)
  }
  const nextVersion = params.thread.modelHistoryVersion + 1
  const rebased = await params.tx.projectAgentTurn.updateMany({
    where: {
      id: params.turnId,
      modelHistoryBaseVersion: params.thread.modelHistoryVersion,
    },
    data: { modelHistoryBaseVersion: nextVersion },
  })
  if (rebased.count !== 1) {
    throw new Error(`AGENT_TURN_APPROVAL_HISTORY_BASE_DIVERGED:${params.turnId}`)
  }
  return nextVersion
}
