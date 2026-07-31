import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma, type ProjectAgentTurn } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import type { LlmUsageFact } from '@/lib/billing/llm-usage'
import { prepareProjectAgentOperationInput } from '@/lib/operations/invocation'
import {
  persistOperationPlanView,
  planOperation,
  type OperationPlanView,
} from '@/lib/operations/planning'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  issueApprovalGrantGroup,
  issueApprovalGrantGroupInTransaction,
  type PlannedOperationInvocation,
} from '@/lib/operations/planned-operation-invocation'
import {
  commitProjectAssistantTurnInTransaction,
  lockProjectAssistantThreadScopeInTransaction,
} from '@/lib/project-agent/persistence'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import type { AgentTurnApprovalRequest } from './runner'
import type { AgentTurnExecutionInput } from './contracts'
import { loadClaimedAgentTurnExecutionInput } from './service'
import {
  assertAgentTurnRunStateContract,
  buildAgentTurnRuntimeContract,
  parseAgentTurnRuntimeContract,
  type AgentTurnRuntimeContract,
} from './runtime-contract'
import { recordAgentTurnUsageFactsInTransaction } from './usage'

const MAX_RUN_STATE_BYTES = 16 * 1_024 * 1_024

export interface AgentTurnApprovalMember {
  approvalId: string
  callId: string
  operationId: string
  input: unknown
  inputHash: string
  toolContractRevision: string
  operationPlan: OperationPlanView | null
}

export interface AgentTurnApprovalPayload {
  protocol: 'agent_turn_approval_v1'
  runtime: AgentTurnRuntimeContract
  members: readonly AgentTurnApprovalMember[]
}

export interface ResolveAgentTurnApprovalCommand {
  protocol: 'agent_turn_approval_response_v1'
  threadId: string
  turnId: string
  interactionId: string
  projectId: string
  userId: string
  requestId: string
  decision: 'approve' | 'reject'
  reason: string | null
}

export interface AgentTurnApprovalDecisionReceipt {
  protocol: 'agent_turn_approval_receipt_v1'
  threadId: string
  turnId: string
  interactionId: string
  projectId: string
  episodeId: string | null
  requestId: string
  decision: 'approve' | 'reject'
  payloadHash: string
  resumeRequired: boolean
}

export interface AgentTurnApprovalResume {
  input: AgentTurnExecutionInput
  interactionId: string
  runState: string
  decision: 'approve' | 'reject'
  reason: string | null
  runtime: AgentTurnRuntimeContract
  members: readonly AgentTurnApprovalMember[]
  approvedInvocationByCallId: Readonly<Record<string, PlannedOperationInvocation>>
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('AGENT_TURN_APPROVAL_JSON_INVALID')
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function buildInteractionId(params: {
  turnId: string
  approvals: readonly AgentTurnApprovalRequest[]
}): string {
  const identities = params.approvals
    .map((item) => [item.approvalId, item.callId, item.operationId])
    .sort(([left], [right]) => left.localeCompare(right))
  return `turn_interaction_${digest(JSON.stringify(['agent-turn-approval-v1', params.turnId, identities])).slice(0, 40)}`
}

function requireIdentity(value: string, code: string, maxLength = 191): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(code)
  }
  return value
}

export function parseAgentTurnApprovalPayload(value: unknown): AgentTurnApprovalPayload {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { protocol?: unknown }).protocol !== 'agent_turn_approval_v1' ||
    !Array.isArray((value as { members?: unknown }).members)
  ) {
    throw new Error('AGENT_TURN_APPROVAL_PAYLOAD_INVALID')
  }
  const members = (value as { members: unknown[] }).members.map((member) => {
    if (!member || typeof member !== 'object' || Array.isArray(member)) {
      throw new Error('AGENT_TURN_APPROVAL_MEMBER_INVALID')
    }
    const record = member as Record<string, unknown>
    const approvalId = requireIdentity(
      String(record.approvalId ?? ''),
      'AGENT_TURN_APPROVAL_ID_INVALID',
    )
    const callId = requireIdentity(
      String(record.callId ?? ''),
      'AGENT_TURN_APPROVAL_CALL_ID_INVALID',
    )
    const operationId = requireIdentity(
      String(record.operationId ?? ''),
      'AGENT_TURN_APPROVAL_OPERATION_ID_INVALID',
      128,
    )
    const inputHash = requireIdentity(
      String(record.inputHash ?? ''),
      'AGENT_TURN_APPROVAL_INPUT_HASH_INVALID',
      64,
    )
    if (hashCanonicalJson(record.input) !== inputHash) {
      throw new Error('AGENT_TURN_APPROVAL_INPUT_HASH_DIVERGED')
    }
    const toolContractRevision = requireIdentity(
      String(record.toolContractRevision ?? ''),
      'AGENT_TURN_APPROVAL_TOOL_CONTRACT_REVISION_INVALID',
      128,
    )
    return {
      approvalId,
      callId,
      operationId,
      input: record.input,
      inputHash,
      toolContractRevision,
      operationPlan:
        record.operationPlan === null ? null : (record.operationPlan as OperationPlanView),
    }
  })
  if (
    members.length === 0 ||
    new Set(members.map((item) => item.callId)).size !== members.length ||
    new Set(members.map((item) => item.approvalId)).size !== members.length
  ) {
    throw new Error('AGENT_TURN_APPROVAL_MEMBERS_INVALID')
  }
  return {
    protocol: 'agent_turn_approval_v1',
    runtime: parseAgentTurnRuntimeContract((value as { runtime?: unknown }).runtime),
    members,
  }
}

function validateDecisionCommand(command: ResolveAgentTurnApprovalCommand): void {
  if (command.protocol !== 'agent_turn_approval_response_v1') {
    throw new Error('AGENT_TURN_APPROVAL_RESPONSE_PROTOCOL_INVALID')
  }
  requireIdentity(command.threadId, 'AGENT_TURN_APPROVAL_THREAD_ID_INVALID')
  requireIdentity(command.turnId, 'AGENT_TURN_APPROVAL_TURN_ID_INVALID')
  requireIdentity(command.interactionId, 'AGENT_TURN_APPROVAL_INTERACTION_ID_INVALID')
  requireIdentity(command.projectId, 'AGENT_TURN_APPROVAL_PROJECT_ID_INVALID')
  requireIdentity(command.userId, 'AGENT_TURN_APPROVAL_USER_ID_INVALID')
  requireIdentity(command.requestId, 'AGENT_TURN_APPROVAL_REQUEST_ID_INVALID', 128)
  if (command.decision !== 'approve' && command.decision !== 'reject') {
    throw new Error('AGENT_TURN_APPROVAL_DECISION_INVALID')
  }
  if (
    command.reason !== null &&
    (!command.reason || command.reason !== command.reason.trim() || command.reason.length > 2_000)
  ) {
    throw new Error('AGENT_TURN_APPROVAL_REASON_INVALID')
  }
}

interface StoredApprovalResponse {
  protocol: 'agent_turn_approval_response_v1'
  requestId: string
  decision: 'approve' | 'reject'
  reason: string | null
  grants: readonly {
    callId: string
    operationId: string
    approvalGrantId: string
    requestId: string
  }[]
  via?: 'user_message'
  successorTurnId?: string
}

function parseStoredResponse(value: unknown): StoredApprovalResponse {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { protocol?: unknown }).protocol !== 'agent_turn_approval_response_v1' ||
    !Array.isArray((value as { grants?: unknown }).grants)
  ) {
    throw new Error('AGENT_TURN_APPROVAL_RESPONSE_INVALID')
  }
  return value as unknown as StoredApprovalResponse
}

export async function loadSupersededAgentTurnApprovalInput(
  currentTurnId: string,
): Promise<AgentInputItem | null> {
  const current = await prisma.projectAgentTurn.findUnique({
    where: { id: currentTurnId },
    select: { id: true, threadId: true, sourceKind: true },
  })
  if (!current || current.sourceKind !== 'user') return null
  const rows = await prisma.$queryRaw<
    Array<{
      payloadJson: Prisma.JsonValue
      responseJson: Prisma.JsonValue
    }>
  >(Prisma.sql`
    SELECT interaction.payloadJson, interaction.responseJson
    FROM agent_turn_interactions interaction
    JOIN project_agent_turns prior_turn
      ON prior_turn.id = interaction.turnId
    WHERE prior_turn.threadId = ${current.threadId}
      AND prior_turn.status = 'cancelled'
      AND interaction.kind = 'approval'
      AND interaction.status = 'rejected'
      AND JSON_UNQUOTE(
        JSON_EXTRACT(interaction.responseJson, '$.successorTurnId')
      ) = ${current.id}
    ORDER BY interaction.createdAt ASC, interaction.id ASC
  `)
  if (rows.length === 0) return null
  const operations = rows.flatMap((row) => {
    const response = parseStoredResponse(row.responseJson)
    if (response.via !== 'user_message' || response.successorTurnId !== current.id) {
      throw new Error(`AGENT_TURN_APPROVAL_SUPERSEDE_FACT_DIVERGED:${current.id}`)
    }
    return parseAgentTurnApprovalPayload(row.payloadJson).members.map((member) => ({
      callId: member.callId,
      operationId: member.operationId,
    }))
  })
  return {
    role: 'user',
    content: [
      '[approval_declined]',
      ...operations.map(
        (operation) => `call=${operation.callId} operation=${operation.operationId}`,
      ),
      'The user declined these pending operations by sending a new message. Treat them as rejected and do not retry or request them again unless the new message explicitly asks you to.',
      '[/approval_declined]',
    ].join('\n'),
  } satisfies AgentInputItem
}

export async function prepareAgentTurnApprovalPayload(params: {
  input: AgentTurnExecutionInput
  approvals: readonly AgentTurnApprovalRequest[]
  signal: AbortSignal
}): Promise<AgentTurnApprovalPayload> {
  if (params.approvals.length === 0) {
    throw new Error('AGENT_TURN_APPROVAL_MEMBERS_REQUIRED')
  }
  const registry = createProjectAgentOperationRegistry()
  const members: AgentTurnApprovalMember[] = []
  for (const approval of params.approvals) {
    params.signal.throwIfAborted()
    const operation = registry[approval.operationId]
    if (!operation?.channels.tool || !operation.confirmation.required) {
      throw new Error(`AGENT_TURN_APPROVAL_OPERATION_INVALID:${approval.operationId}`)
    }
    if (!operation.toolContractRevision) {
      throw new Error(`AGENT_TURN_APPROVAL_TOOL_CONTRACT_REVISION_MISSING:${operation.id}`)
    }
    let operationPlan: OperationPlanView | null = null
    if (operation.plan) {
      const prepared = prepareProjectAgentOperationInput({
        channel: 'tool',
        operation,
        context: {
          ...(params.input.context.locale ? { locale: params.input.context.locale } : {}),
          episodeId: params.input.context.episodeId,
          turnId: params.input.turn.id,
          selectedScopeRef: params.input.context.selectedScopeRef,
          selectedAssetId: params.input.context.selectedAssetId,
        },
        input: approval.input,
      })
      if (prepared.invocation) {
        throw new Error(`AGENT_TURN_APPROVAL_PROVENANCE_AMBIGUOUS:${operation.id}`)
      }
      const plan = await planOperation({
        operation,
        ctx: {
          request: null,
          requestId: params.input.turn.requestId,
          signal: params.signal,
          userId: params.input.turn.userId,
          projectId: params.input.turn.projectId,
          context: {
            ...(params.input.context.locale ? { locale: params.input.context.locale } : {}),
            episodeId: params.input.context.episodeId,
            turnId: params.input.turn.id,
            selectedScopeRef: params.input.context.selectedScopeRef,
            selectedAssetId: params.input.context.selectedAssetId,
          },
          invocationChannel: 'tool',
          source: 'assistant-panel',
          writer: null,
          toolCallId: approval.callId,
          activityId: null,
        },
        input: prepared.input,
      })
      operationPlan = await persistOperationPlanView({
        plan,
        executionContractRevision: operation.planContractRevision,
        normalizedInput: prepared.input,
        episodeId: params.input.context.episodeId,
      })
      if (!operationPlan.planSnapshotId) {
        throw new Error(`AGENT_TURN_APPROVAL_PLAN_ID_MISSING:${operation.id}`)
      }
    }
    members.push({
      ...approval,
      toolContractRevision: operation.toolContractRevision,
      operationPlan,
    })
  }
  return {
    protocol: 'agent_turn_approval_v1',
    runtime: buildAgentTurnRuntimeContract(),
    members,
  }
}

export async function authorizeAgentTurnOperationAutomatically(params: {
  input: AgentTurnExecutionInput
  approval: AgentTurnApprovalRequest
  signal: AbortSignal
}): Promise<PlannedOperationInvocation> {
  const payload = await prepareAgentTurnApprovalPayload({
    input: params.input,
    approvals: [params.approval],
    signal: params.signal,
  })
  const member = payload.members[0]
  const planSnapshotId = member?.operationPlan?.planSnapshotId ?? null
  if (!member || member.callId !== params.approval.callId || !planSnapshotId) {
    throw new Error(`AGENT_TURN_AUTOMATIC_APPROVAL_PLAN_MISSING:${params.approval.callId}`)
  }
  const [grant] = await issueApprovalGrantGroup({
    userId: params.input.turn.userId,
    requests: [
      {
        planSnapshotId,
        requestId: `agent-turn-auto:${params.input.turn.id}:${member.callId}`,
      },
    ],
  })
  if (!grant || grant.operationId !== member.operationId) {
    throw new Error(`AGENT_TURN_AUTOMATIC_APPROVAL_GRANT_DIVERGED:${member.callId}`)
  }
  return {
    approvalGrantId: grant.approvalGrantId,
    requestId: grant.requestId,
  }
}

export async function suspendAgentTurnForApproval(params: {
  input: AgentTurnExecutionInput
  executionOwnerId: string
  assistantMessage: UIMessage
  modelHistoryItems: readonly AgentInputItem[]
  runState: string
  payload: AgentTurnApprovalPayload
  usageFacts: readonly LlmUsageFact[]
}): Promise<{
  turnId: string
  interactionId: string
  status: 'waiting_approval'
}> {
  if (params.assistantMessage.role !== 'assistant') {
    throw new Error('AGENT_TURN_APPROVAL_MESSAGE_ROLE_INVALID')
  }
  if (
    !params.assistantMessage.id ||
    params.assistantMessage.id !== params.assistantMessage.id.trim() ||
    params.assistantMessage.id.length > 191
  ) {
    throw new Error('AGENT_TURN_APPROVAL_MESSAGE_ID_INVALID')
  }
  if (!params.runState || Buffer.byteLength(params.runState, 'utf8') > MAX_RUN_STATE_BYTES) {
    throw new Error('AGENT_TURN_APPROVAL_RUN_STATE_INVALID')
  }
  assertAgentTurnRunStateContract({
    runState: params.runState,
    runtime: params.payload.runtime,
  })
  const interactionId = buildInteractionId({
    turnId: params.input.turn.id,
    approvals: params.payload.members,
  })
  const payloadJson = toJson(params.payload)
  await prisma.$transaction(
    async (tx) => {
      await lockProjectAssistantThreadScopeInTransaction(tx, {
        threadId: params.input.turn.threadId,
        projectId: params.input.turn.projectId,
        userId: params.input.turn.userId,
        episodeId: params.input.turn.episodeId,
        assistantId: 'workspace-command',
      })
      const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${params.input.turn.id}
      FOR UPDATE
    `)
      const turn = rows[0] ?? null
      if (!turn) {
        throw new Error(`AGENT_TURN_NOT_FOUND:${params.input.turn.id}`)
      }
      const existing = await tx.agentTurnInteraction.findUnique({
        where: { id: interactionId },
      })
      if (existing) {
        if (
          existing.turnId !== turn.id ||
          existing.kind !== 'approval' ||
          existing.status !== 'pending' ||
          existing.runState !== params.runState ||
          !isDeepStrictEqual(existing.payloadJson, payloadJson) ||
          turn.status !== 'waiting_approval' ||
          turn.assistantMessageId !== params.assistantMessage.id
        ) {
          throw new Error(`AGENT_TURN_APPROVAL_REPLAY_DIVERGED:${interactionId}`)
        }
        return
      }
      if (
        turn.status !== 'running' ||
        turn.executionOwnerId !== params.executionOwnerId ||
        turn.modelHistoryBaseVersion !== params.input.modelHistory.version
      ) {
        throw new Error(`AGENT_TURN_APPROVAL_FENCE_DIVERGED:${turn.id}:${turn.status}`)
      }
      await recordAgentTurnUsageFactsInTransaction({
        tx,
        turnId: turn.id,
        attempt: turn.attempt,
        projectId: turn.projectId,
        userId: turn.userId,
        usageFacts: params.usageFacts,
      })
      await commitProjectAssistantTurnInTransaction(tx, {
        threadId: turn.threadId,
        projectId: turn.projectId,
        userId: turn.userId,
        episodeId: turn.episodeId,
        assistantId: 'workspace-command',
        expectedModelHistoryVersion: params.input.modelHistory.version,
        messages: [params.assistantMessage],
        modelHistoryItems: params.modelHistoryItems,
      })
      await tx.agentTurnInteraction.create({
        data: {
          id: interactionId,
          turnId: turn.id,
          kind: 'approval',
          status: 'pending',
          payloadJson,
          runState: params.runState,
        },
      })
      await tx.agentTurnInteraction.updateMany({
        where: {
          turnId: turn.id,
          kind: 'approval',
          status: { in: ['approved', 'rejected'] },
          runState: { not: null },
        },
        data: { runState: null },
      })
      await tx.projectAgentTurn.update({
        where: { id: turn.id },
        data: {
          status: 'waiting_approval',
          assistantMessageId: params.assistantMessage.id,
          stopReason: 'awaiting_approval',
          modelHistoryBaseVersion: params.input.modelHistory.version + 1,
        },
      })
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
  return {
    turnId: params.input.turn.id,
    interactionId,
    status: 'waiting_approval',
  }
}

export async function resolveAgentTurnApprovalDecision(
  command: ResolveAgentTurnApprovalCommand,
): Promise<AgentTurnApprovalDecisionReceipt> {
  validateDecisionCommand(command)
  const identity = await prisma.agentTurnInteraction.findUnique({
    where: { id: command.interactionId },
    select: {
      id: true,
      turnId: true,
      turn: {
        select: {
          threadId: true,
          projectId: true,
          userId: true,
        },
      },
    },
  })
  if (!identity) {
    throw new Error(`AGENT_TURN_APPROVAL_NOT_FOUND:${command.interactionId}`)
  }
  if (
    identity.turnId !== command.turnId ||
    identity.turn.threadId !== command.threadId ||
    identity.turn.projectId !== command.projectId ||
    identity.turn.userId !== command.userId
  ) {
    throw new Error(`AGENT_TURN_APPROVAL_SCOPE_DIVERGED:${command.interactionId}`)
  }
  const resolution = await prisma.$transaction(
    async (tx) => {
      const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${command.projectId}
      FOR UPDATE
    `)
      if (projects.length !== 1) {
        throw new Error(`AGENT_TURN_APPROVAL_PROJECT_NOT_FOUND:${command.projectId}`)
      }
      const threads = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_assistant_threads
      WHERE id = ${command.threadId}
      FOR UPDATE
    `)
      if (threads.length !== 1) {
        throw new Error(`AGENT_TURN_APPROVAL_THREAD_NOT_FOUND:${command.threadId}`)
      }
      const turns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${command.turnId}
      FOR UPDATE
    `)
      const turn = turns[0] ?? null
      const interactions = await tx.$queryRaw<
        Array<{
          id: string
          turnId: string
          kind: string
          status: string
          payloadJson: Prisma.JsonValue
          runState: string | null
          responseJson: Prisma.JsonValue | null
          version: number
        }>
      >(Prisma.sql`
      SELECT id, turnId, kind, status, payloadJson, runState,
             responseJson, version
      FROM agent_turn_interactions
      WHERE id = ${command.interactionId}
      FOR UPDATE
    `)
      const interaction = interactions[0] ?? null
      if (
        !turn ||
        !interaction ||
        turn.threadId !== command.threadId ||
        turn.projectId !== command.projectId ||
        turn.userId !== command.userId ||
        interaction.turnId !== turn.id ||
        interaction.kind !== 'approval'
      ) {
        throw new Error(`AGENT_TURN_APPROVAL_SCOPE_DIVERGED:${command.interactionId}`)
      }
      if (interaction.status === 'approved' || interaction.status === 'rejected') {
        const stored = parseStoredResponse(interaction.responseJson)
        if (
          stored.requestId !== command.requestId ||
          stored.decision !== command.decision ||
          stored.reason !== command.reason
        ) {
          throw new Error(`AGENT_TURN_APPROVAL_RESPONSE_REPLAY_DIVERGED:${interaction.id}`)
        }
        return {
          resumeRequired: turn.status === 'waiting_approval',
          episodeId: turn.episodeId,
        }
      }
      if (
        interaction.status !== 'pending' ||
        interaction.version !== 0 ||
        turn.status !== 'waiting_approval' ||
        !interaction.runState
      ) {
        throw new Error(
          `AGENT_TURN_APPROVAL_RESPONSE_REJECTED:${interaction.id}:${interaction.status}:${turn.status}`,
        )
      }
      const payload = parseAgentTurnApprovalPayload(interaction.payloadJson)
      const grants =
        command.decision === 'approve'
          ? await issueApprovalGrantGroupInTransaction(tx, {
              userId: command.userId,
              requests: payload.members.flatMap((member) =>
                member.operationPlan?.planSnapshotId
                  ? [
                      {
                        planSnapshotId: member.operationPlan.planSnapshotId,
                        requestId: `agent-turn-approval:${interaction.id}:${member.callId}`,
                      },
                    ]
                  : [],
              ),
            })
          : []
      const grantByPlanId = new Map(grants.map((grant) => [grant.planSnapshotId, grant]))
      const response: StoredApprovalResponse = {
        protocol: 'agent_turn_approval_response_v1',
        requestId: command.requestId,
        decision: command.decision,
        reason: command.reason,
        grants: payload.members.flatMap((member) => {
          const planSnapshotId = member.operationPlan?.planSnapshotId ?? null
          if (!planSnapshotId) return []
          const grant = grantByPlanId.get(planSnapshotId)
          if (!grant || grant.operationId !== member.operationId) {
            throw new Error(`AGENT_TURN_APPROVAL_GRANT_DIVERGED:${member.callId}`)
          }
          return [
            {
              callId: member.callId,
              operationId: member.operationId,
              approvalGrantId: grant.approvalGrantId,
              requestId: grant.requestId,
            },
          ]
        }),
      }
      await tx.agentTurnInteraction.update({
        where: { id: interaction.id },
        data: {
          status: command.decision === 'approve' ? 'approved' : 'rejected',
          responseJson: toJson(response),
          version: { increment: 1 },
          resolvedAt: new Date(),
        },
      })
      return { resumeRequired: true, episodeId: turn.episodeId }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
  return {
    protocol: 'agent_turn_approval_receipt_v1',
    threadId: command.threadId,
    turnId: command.turnId,
    interactionId: command.interactionId,
    projectId: command.projectId,
    episodeId: resolution.episodeId,
    requestId: command.requestId,
    decision: command.decision,
    payloadHash: hashCanonicalJson(command),
    resumeRequired: resolution.resumeRequired,
  }
}

export async function claimAgentTurnApprovalResume(params: {
  interactionId: string
  executionOwnerId: string
}): Promise<AgentTurnApprovalResume> {
  const interactionId = requireIdentity(
    params.interactionId,
    'AGENT_TURN_APPROVAL_INTERACTION_ID_INVALID',
  )
  const executionOwnerId = requireIdentity(
    params.executionOwnerId,
    'AGENT_TURN_APPROVAL_RESUME_OWNER_INVALID',
  )
  const identity = await prisma.agentTurnInteraction.findUnique({
    where: { id: interactionId },
    select: {
      turnId: true,
      turn: {
        select: {
          threadId: true,
          projectId: true,
        },
      },
    },
  })
  if (!identity) {
    throw new Error(`AGENT_TURN_APPROVAL_NOT_FOUND:${interactionId}`)
  }
  const settled = await prisma.$transaction(
    async (tx) => {
      const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${identity.turn.projectId}
      FOR UPDATE
    `)
      if (projects.length !== 1) {
        throw new Error(`AGENT_TURN_APPROVAL_PROJECT_NOT_FOUND:${identity.turn.projectId}`)
      }
      const threads = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_assistant_threads
      WHERE id = ${identity.turn.threadId}
      FOR UPDATE
    `)
      if (threads.length !== 1) {
        throw new Error(`AGENT_TURN_APPROVAL_THREAD_NOT_FOUND:${identity.turn.threadId}`)
      }
      const turns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${identity.turnId}
      FOR UPDATE
    `)
      const turn = turns[0] ?? null
      const interactions = await tx.$queryRaw<
        Array<{
          id: string
          turnId: string
          kind: string
          status: string
          payloadJson: Prisma.JsonValue
          runState: string | null
          responseJson: Prisma.JsonValue | null
          version: number
        }>
      >(Prisma.sql`
      SELECT id, turnId, kind, status, payloadJson, runState,
             responseJson, version
      FROM agent_turn_interactions
      WHERE id = ${interactionId}
      FOR UPDATE
    `)
      const interaction = interactions[0] ?? null
      const payload = interaction ? parseAgentTurnApprovalPayload(interaction.payloadJson) : null
      if (
        !turn ||
        !interaction ||
        !payload ||
        interaction.turnId !== turn.id ||
        interaction.kind !== 'approval' ||
        !interaction.runState ||
        (interaction.status !== 'approved' && interaction.status !== 'rejected') ||
        interaction.version !== 1
      ) {
        throw new Error(`AGENT_TURN_APPROVAL_RESUME_STATE_INVALID:${interactionId}`)
      }
      assertAgentTurnRunStateContract({
        runState: interaction.runState,
        runtime: payload.runtime,
      })
      if (turn.status === 'running' && turn.executionOwnerId === executionOwnerId) {
        return {
          turnId: turn.id,
          runState: interaction.runState,
          payload,
          response: parseStoredResponse(interaction.responseJson),
        }
      }
      if (turn.status !== 'waiting_approval') {
        throw new Error(`AGENT_TURN_APPROVAL_RESUME_FENCE_DIVERGED:${turn.id}:${turn.status}`)
      }
      await tx.projectAgentTurn.update({
        where: { id: turn.id },
        data: {
          status: 'running',
          attempt: { increment: 1 },
          executionOwnerId,
          stopReason: null,
        },
      })
      return {
        turnId: turn.id,
        runState: interaction.runState,
        payload,
        response: parseStoredResponse(interaction.responseJson),
      }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
  const input = await loadClaimedAgentTurnExecutionInput({
    turnId: settled.turnId,
    executionOwnerId,
  })
  const approvedInvocationByCallId = Object.fromEntries(
    settled.response.grants.map((grant) => [
      grant.callId,
      {
        approvalGrantId: grant.approvalGrantId,
        requestId: grant.requestId,
      },
    ]),
  )
  return {
    input,
    interactionId,
    runState: settled.runState,
    decision: settled.response.decision,
    reason: settled.response.reason,
    runtime: settled.payload.runtime,
    members: settled.payload.members,
    approvedInvocationByCallId,
  }
}
