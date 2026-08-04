import { createHash } from 'node:crypto'
import { Prisma, type AgentToolEffect } from '@prisma/client'
import { canonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { prisma } from '@/lib/prisma'
import { lockAgentTurnEffectFence } from './effect-fence'

const MAX_TOOL_EFFECT_RESULT_BYTES = 2 * 1_024 * 1_024

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function requireIdentity(value: string, code: string, maxLength = 191): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(code)
  }
  return value
}

function serializeResult(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('AGENT_TOOL_EFFECT_RESULT_NOT_JSON')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TOOL_EFFECT_RESULT_BYTES) {
    throw new Error('AGENT_TOOL_EFFECT_RESULT_TOO_LARGE')
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function parseResult(
  value: Prisma.JsonValue | Prisma.InputJsonValue,
): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function assertStoredIdentity(params: {
  row: AgentToolEffect
  turnId: string
  callId: string
  operationId: string
  contractRevision: string
  inputHash: string
}): void {
  if (
    params.row.turnId !== params.turnId
    || params.row.callId !== params.callId
    || params.row.operationId !== params.operationId
    || params.row.contractRevision !== params.contractRevision
    || params.row.inputHash !== params.inputHash
  ) {
    throw new Error(
      `AGENT_TOOL_EFFECT_REPLAY_DIVERGED:${params.turnId}:${params.callId}`,
    )
  }
}

export function buildAgentToolEffectInputHash(params: {
  operationId: string
  contractRevision: string
  input: unknown
}): string {
  return digest(canonicalJson({
    protocol: 'agent_tool_effect_input_v1',
    operationId: params.operationId,
    contractRevision: params.contractRevision,
    input: params.input,
  }))
}

function buildAgentToolEffectId(params: {
  turnId: string
  callId: string
}): string {
  const turnId = requireIdentity(params.turnId, 'AGENT_TOOL_EFFECT_TURN_ID_INVALID')
  const callId = requireIdentity(params.callId, 'AGENT_TOOL_EFFECT_CALL_ID_INVALID')
  return `tool_effect_${digest(canonicalJson([
    'agent-tool-effect-v1',
    turnId,
    callId,
  ])).slice(0, 40)}`
}

/**
 * Executes one synchronous effect and commits its exact model-facing result
 * with the business transaction. A committed result is replayed; an
 * uncommitted crash leaves neither the ledger row nor the business mutation.
 */
export async function executeAgentToolEffectTransaction(params: {
  turnId: string
  executionOwnerId: string
  callId: string
  operationId: string
  contractRevision: string
  inputHash: string
  execute: (tx: Prisma.TransactionClient) => Promise<unknown>
}): Promise<unknown> {
  const turnId = requireIdentity(params.turnId, 'AGENT_TOOL_EFFECT_TURN_ID_INVALID')
  const executionOwnerId = requireIdentity(
    params.executionOwnerId,
    'AGENT_TOOL_EFFECT_OWNER_INVALID',
  )
  const callId = requireIdentity(params.callId, 'AGENT_TOOL_EFFECT_CALL_ID_INVALID')
  const operationId = requireIdentity(
    params.operationId,
    'AGENT_TOOL_EFFECT_OPERATION_ID_INVALID',
    128,
  )
  const contractRevision = requireIdentity(
    params.contractRevision,
    'AGENT_TOOL_EFFECT_CONTRACT_REVISION_INVALID',
    128,
  )
  const inputHash = requireIdentity(
    params.inputHash,
    'AGENT_TOOL_EFFECT_INPUT_HASH_INVALID',
    64,
  )
  const identity = await prisma.projectAgentTurn.findUnique({
    where: { id: turnId },
    select: {
      id: true,
      threadId: true,
      projectId: true,
      userId: true,
    },
  })
  if (!identity) throw new Error(`AGENT_TURN_NOT_FOUND:${turnId}`)
  const effectId = buildAgentToolEffectId({ turnId, callId })
  return await prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${identity.projectId}
      FOR UPDATE
    `)
    if (projects.length !== 1) {
      throw new Error(`AGENT_TOOL_EFFECT_PROJECT_NOT_FOUND:${identity.projectId}`)
    }
    const threads = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_assistant_threads
      WHERE id = ${identity.threadId}
      FOR UPDATE
    `)
    if (threads.length !== 1) {
      throw new Error(`AGENT_TOOL_EFFECT_THREAD_NOT_FOUND:${identity.threadId}`)
    }
    const turn = await lockAgentTurnEffectFence(tx, {
      turnId,
      projectId: identity.projectId,
      userId: identity.userId,
    })
    if (
      turn.threadId !== identity.threadId
      || turn.executionOwnerId !== executionOwnerId
    ) {
      throw new Error(
        `AGENT_TOOL_EFFECT_TURN_FENCE_DIVERGED:${turnId}:${turn?.status ?? 'missing'}`,
      )
    }
    const existing = await tx.agentToolEffect.findUnique({
      where: { turnId_callId: { turnId, callId } },
    })
    if (existing) {
      assertStoredIdentity({
        row: existing,
        turnId,
        callId,
        operationId,
        contractRevision,
        inputHash,
      })
      return parseResult(existing.resultJson)
    }
    const result = await params.execute(tx)
    const resultJson = serializeResult(result)
    await tx.agentToolEffect.create({
      data: {
        id: effectId,
        turnId,
        callId,
        operationId,
        contractRevision,
        inputHash,
        resultJson,
      },
    })
    return parseResult(resultJson)
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  })
}
