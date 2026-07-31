import { Prisma, type ProjectAgentTurn } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import type { LlmUsageFact } from '@/lib/billing/llm-usage'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  commitProjectAssistantTurnInTransaction,
  parseProjectAssistantModelHistory,
  validateProjectAssistantThreadMessages,
} from '@/lib/project-agent/persistence'
import {
  AGENT_TURN_SOURCE_KIND,
  isAgentTurnStatus,
  type AgentTurnCommandEnvelope,
  type AgentTurnContextSnapshot,
  type AgentTurnExecutionInput,
  type AgentThreadRecoveryState,
  type AgentTurnRecord,
  type AgentTurnSourceKind,
  type AgentTurnStatus,
} from './contracts'
import { assertAgentTurnEnvelope, buildAgentTurnId } from './identity'
import { closeAgentTurnApprovalHistoryInTransaction } from './approval-history'
import { recordAgentTurnUsageFactsInTransaction } from './usage'

export type AgentTurnAdmissionDecision =
  | { outcome: 'accepted'; turn: AgentTurnRecord }
  | { outcome: 'ignored'; reason: 'source_cancelled' }

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('AGENT_TURN_JSON_INVALID')
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseNullableString(value: unknown, code: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(code)
  }
  return value
}

function parseContext(value: unknown): AgentTurnContextSnapshot {
  if (!isRecord(value)) throw new Error('AGENT_TURN_CONTEXT_INVALID')
  return {
    locale: parseNullableString(value.locale, 'AGENT_TURN_LOCALE_INVALID'),
    episodeId: parseNullableString(value.episodeId, 'AGENT_TURN_EPISODE_ID_INVALID'),
    selectedScopeRef: parseNullableString(value.selectedScopeRef, 'AGENT_TURN_SCOPE_REF_INVALID'),
    selectedAssetId: parseNullableString(value.selectedAssetId, 'AGENT_TURN_ASSET_ID_INVALID'),
  }
}

async function parseStoredUserMessage(value: unknown): Promise<UIMessage | null> {
  if (value === null) return null
  const messages = await validateProjectAssistantThreadMessages([value])
  const message = messages[0] ?? null
  if (!message || message.role !== 'user') {
    throw new Error('AGENT_TURN_STORED_USER_MESSAGE_INVALID')
  }
  return message
}

function parseSourceKind(value: string): AgentTurnSourceKind {
  if (
    value === AGENT_TURN_SOURCE_KIND.USER ||
    value === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP ||
    value === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE
  ) {
    return value
  }
  throw new Error(`AGENT_TURN_SOURCE_KIND_INVALID:${value}`)
}

function parseStatus(value: string): AgentTurnStatus {
  if (isAgentTurnStatus(value)) return value
  throw new Error(`AGENT_TURN_STATUS_INVALID:${value}`)
}

function toRecord(row: ProjectAgentTurn): AgentTurnRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    projectId: row.projectId,
    userId: row.userId,
    episodeId: row.episodeId,
    sourceKind: parseSourceKind(row.sourceKind),
    sourceId: row.sourceId,
    payloadHash: row.payloadHash,
    requestId: row.requestId,
    status: parseStatus(row.status),
    attempt: row.attempt,
    modelHistoryBaseVersion: row.modelHistoryBaseVersion,
    stopReason: row.stopReason,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  }
}

async function clearResolvedApprovalRunStateInTransaction(
  tx: Prisma.TransactionClient,
  turnId: string,
): Promise<void> {
  await tx.agentTurnInteraction.updateMany({
    where: {
      turnId,
      kind: 'approval',
      status: { in: ['approved', 'rejected'] },
      runState: { not: null },
    },
    data: { runState: null },
  })
}

async function lockAgentTurnScopeInTransaction(params: {
  tx: Prisma.TransactionClient
  turnId: string
  projectId: string
  threadId: string
}): Promise<{
  thread: {
    id: string
    modelHistoryVersion: number
    modelHistoryJson: Prisma.JsonValue
  }
  turn: ProjectAgentTurn
}> {
  const projects = await params.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM projects WHERE id = ${params.projectId} FOR UPDATE
  `)
  if (projects.length !== 1) {
    throw new Error(`AGENT_TURN_PROJECT_NOT_FOUND:${params.projectId}`)
  }
  const threads = await params.tx.$queryRaw<
    Array<{
      id: string
      modelHistoryVersion: number
      modelHistoryJson: Prisma.JsonValue
    }>
  >(Prisma.sql`
    SELECT id, modelHistoryVersion, modelHistoryJson
    FROM project_assistant_threads
    WHERE id = ${params.threadId}
    FOR UPDATE
  `)
  const thread = threads[0]
  if (!thread) throw new Error(`AGENT_TURN_THREAD_NOT_FOUND:${params.threadId}`)
  const turns = await params.tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
    SELECT * FROM project_agent_turns WHERE id = ${params.turnId} FOR UPDATE
  `)
  const turn = turns[0]
  if (!turn || turn.projectId !== params.projectId || turn.threadId !== params.threadId) {
    throw new Error(`AGENT_TURN_SCOPE_DIVERGED:${params.turnId}`)
  }
  return { thread, turn }
}

function assertStoredCommand(row: ProjectAgentTurn, envelope: AgentTurnCommandEnvelope): void {
  const command = envelope.command
  if (
    row.id !== buildAgentTurnId(command) ||
    row.threadId !== command.threadId ||
    row.projectId !== command.projectId ||
    row.userId !== command.userId ||
    row.episodeId !== command.context.episodeId ||
    row.sourceKind !== command.sourceKind ||
    row.sourceId !== command.sourceId ||
    row.payloadHash !== envelope.payloadHash ||
    row.requestId !== command.requestId
  ) {
    throw new Error(
      `AGENT_TURN_STORED_FACTS_DIVERGED:${command.threadId}:${command.sourceKind}:${command.sourceId}`,
    )
  }
}

async function loadTurnBySource(
  tx: Prisma.TransactionClient,
  envelope: AgentTurnCommandEnvelope,
): Promise<ProjectAgentTurn | null> {
  const command = envelope.command
  return await tx.projectAgentTurn.findUnique({
    where: {
      threadId_sourceKind_sourceId: {
        threadId: command.threadId,
        sourceKind: command.sourceKind,
        sourceId: command.sourceId,
      },
    },
  })
}

/**
 * The only writer that turns an accepted Coordinator command into durable
 * product facts. The visible user message and AgentTurn are committed in one
 * transaction; an Update may return accepted only after this function returns.
 */
export async function acceptAgentTurnCommand(
  envelope: AgentTurnCommandEnvelope,
): Promise<AgentTurnAdmissionDecision> {
  assertAgentTurnEnvelope(envelope)
  const command = envelope.command
  return await prisma.$transaction(
    async (tx) => {
      // Keep the repository-wide lock order: stable Project parent first, then
      // Thread. Reversing it here would deadlock against ordinary Thread writes.
      const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM projects
        WHERE id = ${command.projectId}
        FOR UPDATE
      `)
      if (projects.length !== 1) {
        throw new Error(`AGENT_TURN_PROJECT_SCOPE_DIVERGED:${command.projectId}`)
      }
      const locked = await tx.$queryRaw<
        Array<{
          id: string
          projectId: string
          userId: string
          episodeId: string | null
          assistantId: string
          modelHistoryVersion: number
          modelHistoryJson: Prisma.JsonValue
        }>
      >(Prisma.sql`
      SELECT id, projectId, userId, episodeId, assistantId,
             modelHistoryVersion, modelHistoryJson
      FROM project_assistant_threads
      WHERE id = ${command.threadId}
      FOR UPDATE
    `)
      const thread = locked[0] ?? null
      const sourceBatches =
        command.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
          ? await tx.$queryRaw<
              Array<{
                id: string
                threadId: string
                projectId: string
                userId: string
                episodeId: string | null
                assistantId: string
                status: string
                notifiedTurnId: string | null
                contextJson: Prisma.JsonValue
              }>
            >(Prisma.sql`
          SELECT id, threadId, projectId, userId, episodeId, assistantId,
                 status, notifiedTurnId, contextJson
          FROM follow_up_batches
          WHERE id = ${command.sourceId}
          FOR UPDATE
        `)
          : []
      const sourceBatch = sourceBatches[0] ?? null
      if (command.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP) {
        const batchContext = sourceBatch ? parseContext(sourceBatch.contextJson) : null
        if (
          !sourceBatch ||
          sourceBatch.threadId !== command.threadId ||
          sourceBatch.projectId !== command.projectId ||
          sourceBatch.userId !== command.userId ||
          sourceBatch.episodeId !== command.context.episodeId ||
          sourceBatch.assistantId !== command.assistantId ||
          !batchContext ||
          batchContext.locale !== command.context.locale ||
          batchContext.episodeId !== command.context.episodeId ||
          batchContext.selectedScopeRef !== command.context.selectedScopeRef ||
          batchContext.selectedAssetId !== command.context.selectedAssetId
        ) {
          throw new Error(`AGENT_TURN_FOLLOW_UP_SOURCE_DIVERGED:${command.sourceId}`)
        }
        if (sourceBatch.status === 'cancelled') {
          return { outcome: 'ignored', reason: 'source_cancelled' }
        }
        if (sourceBatch.status !== 'ready' && sourceBatch.status !== 'notified') {
          throw new Error(
            `AGENT_TURN_FOLLOW_UP_SOURCE_NOT_READY:${command.sourceId}:${sourceBatch.status}`,
          )
        }
      }
      if (
        !thread ||
        thread.projectId !== command.projectId ||
        thread.userId !== command.userId ||
        thread.episodeId !== command.context.episodeId ||
        thread.assistantId !== command.assistantId
      ) {
        throw new Error(`AGENT_TURN_THREAD_SCOPE_DIVERGED:${command.threadId}`)
      }
      if (command.sourceKind === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE) {
        const choices = await tx.$queryRaw<
          Array<{
            id: string
            kind: string
            status: string
            originalThreadId: string
            responseJson: Prisma.JsonValue | null
          }>
        >(Prisma.sql`
        SELECT interaction.id,
               interaction.kind,
               interaction.status,
               original_turn.threadId AS originalThreadId,
               interaction.responseJson
        FROM agent_turn_interactions interaction
        JOIN project_agent_turns original_turn
          ON original_turn.id = interaction.turnId
        WHERE interaction.id = ${command.sourceId}
        FOR UPDATE
      `)
        const choice = choices[0] ?? null
        if (
          !choice ||
          choice.kind !== 'choice' ||
          choice.status !== 'resolved' ||
          choice.originalThreadId !== command.threadId ||
          choice.responseJson === null
        ) {
          throw new Error(`AGENT_TURN_CHOICE_SOURCE_NOT_READY:${command.sourceId}`)
        }
      }

      const existing = await loadTurnBySource(tx, envelope)
      if (existing) {
        assertStoredCommand(existing, envelope)
        if (
          sourceBatch &&
          (sourceBatch.status !== 'notified' || sourceBatch.notifiedTurnId !== existing.id)
        ) {
          throw new Error(`AGENT_TURN_FOLLOW_UP_REPLAY_DIVERGED:${sourceBatch.id}`)
        }
        return { outcome: 'accepted', turn: toRecord(existing) }
      }
      let acceptedModelHistoryVersion = thread.modelHistoryVersion
      if (command.sourceKind === AGENT_TURN_SOURCE_KIND.USER) {
        const successorTurnId = buildAgentTurnId(command)
        const waitingTurns = await tx.$queryRaw<
          Array<{
            id: string
            interactionId: string
            interactionStatus: string
          }>
        >(
          Prisma.sql`
            SELECT turn.id,
                   interaction.id AS interactionId,
                   interaction.status AS interactionStatus
            FROM project_agent_turns turn
            JOIN agent_turn_interactions interaction
              ON interaction.turnId = turn.id
            WHERE turn.threadId = ${command.threadId}
              AND turn.status = 'waiting_approval'
              AND interaction.kind = 'approval'
              AND interaction.status IN ('pending', 'approved', 'rejected')
              AND interaction.runState IS NOT NULL
            FOR UPDATE
          `,
        )
        const supersededApprovalTurnIds = [...new Set(waitingTurns.map((turn) => turn.id))]
        if (supersededApprovalTurnIds.length > 1) {
          throw new Error(`AGENT_TURN_APPROVAL_SUPERSEDE_AMBIGUOUS:${thread.id}`)
        }
        if (supersededApprovalTurnIds.length > 0) {
          const now = new Date()
          const waitingTurn = waitingTurns[0]
          if (!waitingTurn) {
            throw new Error(`AGENT_TURN_APPROVAL_SUPERSEDE_MISSING:${thread.id}`)
          }
          acceptedModelHistoryVersion = await closeAgentTurnApprovalHistoryInTransaction({
            tx,
            thread,
            turnId: waitingTurn.id,
            terminalMessage: 'The user rejected this pending operation by sending a new message.',
          })
          const resolvedInteraction = waitingTurn.interactionStatus === 'pending'
            ? await tx.agentTurnInteraction.updateMany({
                where: {
                  id: waitingTurn.interactionId,
                  status: 'pending',
                  runState: { not: null },
                },
                data: {
                  status: 'rejected',
                  responseJson: toJson({
                    protocol: 'agent_turn_approval_response_v1',
                    requestId: command.requestId,
                    decision: 'reject',
                    reason: 'superseded_by_user_turn',
                    grants: [],
                    via: 'user_message',
                    successorTurnId,
                  }),
                  runState: null,
                  version: { increment: 1 },
                  resolvedAt: now,
                },
              })
            : await tx.agentTurnInteraction.updateMany({
                where: {
                  id: waitingTurn.interactionId,
                  status: waitingTurn.interactionStatus,
                  runState: { not: null },
                },
                data: {
                  status: 'cancelled',
                  runState: null,
                  version: { increment: 1 },
                  resolvedAt: now,
                },
              })
          if (resolvedInteraction.count !== 1) {
            throw new Error(`AGENT_TURN_APPROVAL_SUPERSEDE_INTERACTION_CONFLICT:${thread.id}`)
          }
          const cancelledApproval = await tx.projectAgentTurn.updateMany({
            where: {
              id: { in: supersededApprovalTurnIds },
              status: 'waiting_approval',
            },
            data: {
              status: 'cancelled',
              stopReason: 'superseded_by_user_turn',
              modelHistoryBaseVersion: acceptedModelHistoryVersion,
              cancelRequestId: command.requestId,
              cancelReason: 'superseded_by_user_turn',
              errorCode: null,
              errorMessage: null,
              finishedAt: now,
            },
          })
          if (cancelledApproval.count !== 1) {
            throw new Error(`AGENT_TURN_APPROVAL_SUPERSEDE_CONFLICT:${thread.id}`)
          }
        }
        const supersededRunningTurns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
          SELECT *
          FROM project_agent_turns
          WHERE threadId = ${command.threadId}
            AND status = 'running'
          FOR UPDATE
        `)
        if (supersededRunningTurns.length > 1) {
          throw new Error(`AGENT_TURN_RUNNING_SUPERSEDE_AMBIGUOUS:${thread.id}`)
        }
        if (supersededApprovalTurnIds.length > 0 && supersededRunningTurns.length > 0) {
          throw new Error(`AGENT_TURN_ACTIVE_SUPERSEDE_AMBIGUOUS:${thread.id}`)
        }
        const supersededRunningTurn = supersededRunningTurns[0] ?? null
        if (supersededRunningTurn) {
          acceptedModelHistoryVersion = await closeAgentTurnApprovalHistoryInTransaction({
            tx,
            thread,
            turnId: supersededRunningTurn.id,
            terminalMessage:
              'The user superseded this Turn with a newer message. Durable Tool, Task, Provider, Billing, and Resource facts remain authoritative.',
          })
        }
        const supersededQueuedTurns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
          SELECT *
          FROM project_agent_turns
          WHERE threadId = ${command.threadId}
            AND status = 'queued'
            AND sourceKind <> ${AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP}
          ORDER BY createdAt ASC, id ASC
          FOR UPDATE
        `)
        const supersededForegroundTurnIds = [
          ...(supersededRunningTurn ? [supersededRunningTurn.id] : []),
          ...supersededQueuedTurns.map((turn) => turn.id),
        ]
        if (supersededForegroundTurnIds.length > 0) {
          const now = new Date()
          await tx.agentTurnInteraction.updateMany({
            where: {
              turnId: { in: supersededForegroundTurnIds },
              status: { in: ['pending', 'approved', 'rejected'] },
            },
            data: {
              status: 'cancelled',
              runState: null,
              version: { increment: 1 },
              resolvedAt: now,
            },
          })
          const cancelled = await tx.projectAgentTurn.updateMany({
            where: {
              id: { in: supersededForegroundTurnIds },
              status: { in: ['queued', 'running'] },
            },
            data: {
              status: 'cancelled',
              stopReason: 'superseded_by_user_turn',
              cancelRequestId: command.requestId,
              cancelReason: 'superseded_by_user_turn',
              errorCode: null,
              errorMessage: null,
              finishedAt: now,
            },
          })
          if (cancelled.count !== supersededForegroundTurnIds.length) {
            throw new Error(`AGENT_TURN_FOREGROUND_SUPERSEDE_CONFLICT:${thread.id}`)
          }
        }
        await tx.agentTurnInteraction.updateMany({
          where: {
            kind: 'choice',
            status: 'pending',
            turn: { threadId: command.threadId },
          },
          data: {
            status: 'cancelled',
            responseJson: toJson({
              protocol: 'agent_turn_choice_superseded_v1',
              successorSourceId: command.sourceId,
            }),
            runState: null,
            version: { increment: 1 },
            resolvedAt: new Date(),
          },
        })
        if (!command.userMessage) {
          throw new Error('AGENT_TURN_USER_MESSAGE_REQUIRED')
        }
        await appendProjectAssistantThreadMessagesInTransaction(tx, {
          projectId: command.projectId,
          userId: command.userId,
          episodeId: command.context.episodeId,
          assistantId: command.assistantId,
          messages: [command.userMessage],
        })
      }
      const created = await tx.projectAgentTurn.create({
        data: {
          id: buildAgentTurnId(command),
          threadId: command.threadId,
          projectId: command.projectId,
          userId: command.userId,
          episodeId: command.context.episodeId,
          sourceKind: command.sourceKind,
          sourceId: command.sourceId,
          payloadHash: envelope.payloadHash,
          requestId: command.requestId,
          status: 'queued',
          attempt: 0,
          userMessageJson: command.userMessage ? toJson(command.userMessage) : Prisma.JsonNull,
          contextJson: toJson(command.context),
          modelHistoryBaseVersion:
            command.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
              ? null
              : acceptedModelHistoryVersion,
        },
      })
      if (sourceBatch) {
        const notified = await tx.followUpBatch.updateMany({
          where: {
            id: sourceBatch.id,
            status: 'ready',
            notifiedTurnId: null,
          },
          data: {
            status: 'notified',
            notifiedTurnId: created.id,
            notifiedAt: new Date(),
          },
        })
        if (notified.count !== 1) {
          throw new Error(`AGENT_TURN_FOLLOW_UP_NOTIFY_CAS_FAILED:${sourceBatch.id}`)
        }
      }
      return { outcome: 'accepted', turn: toRecord(created) }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
}

export async function claimAgentTurnExecution(params: {
  turnId: string
  executionOwnerId: string
}): Promise<AgentTurnRecord> {
  const executionOwnerId = params.executionOwnerId.trim()
  if (!executionOwnerId) throw new Error('AGENT_TURN_EXECUTION_OWNER_REQUIRED')
  const identity = await prisma.projectAgentTurn.findUnique({
    where: { id: params.turnId },
    select: { projectId: true, threadId: true },
  })
  if (!identity) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
  return await prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${identity.projectId}
      FOR UPDATE
    `)
    if (projects.length !== 1) {
      throw new Error(`AGENT_TURN_PROJECT_NOT_FOUND:${identity.projectId}`)
    }
    const threads = await tx.$queryRaw<
      Array<{
        id: string
        modelHistoryVersion: number
      }>
    >(Prisma.sql`
      SELECT id, modelHistoryVersion
      FROM project_assistant_threads
      WHERE id = ${identity.threadId}
      FOR UPDATE
    `)
    const thread = threads[0] ?? null
    if (!thread) {
      throw new Error(`AGENT_TURN_THREAD_NOT_FOUND:${identity.threadId}`)
    }
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${params.turnId}
      FOR UPDATE
    `)
    const row = rows[0] ?? null
    if (!row) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
    if (row.projectId !== identity.projectId || row.threadId !== identity.threadId) {
      throw new Error(`AGENT_TURN_CLAIM_SCOPE_DIVERGED:${row.id}`)
    }
    if (
      row.status === 'running' &&
      row.executionOwnerId === executionOwnerId &&
      row.attempt === 1 &&
      row.modelHistoryBaseVersion === thread.modelHistoryVersion
    ) {
      return toRecord(row)
    }
    if (row.status !== 'queued' || row.attempt !== 0) {
      throw new Error(`AGENT_TURN_CLAIM_REJECTED:${row.id}:${row.status}:${String(row.attempt)}`)
    }
    if (
      row.modelHistoryBaseVersion !== null &&
      row.modelHistoryBaseVersion !== thread.modelHistoryVersion
    ) {
      throw new Error(
        `AGENT_TURN_CLAIM_HISTORY_DIVERGED:${row.id}:${String(row.modelHistoryBaseVersion)}:${String(thread.modelHistoryVersion)}`,
      )
    }
    const updated = await tx.projectAgentTurn.update({
      where: { id: row.id },
      data: {
        status: 'running',
        attempt: 1,
        executionOwnerId,
        modelHistoryBaseVersion: thread.modelHistoryVersion,
        startedAt: new Date(),
      },
    })
    return toRecord(updated)
  })
}

export async function loadClaimedAgentTurnExecutionInput(params: {
  turnId: string
  executionOwnerId: string
}): Promise<AgentTurnExecutionInput> {
  const row = await prisma.projectAgentTurn.findUnique({
    where: { id: params.turnId },
    include: {
      thread: {
        select: {
          id: true,
          projectId: true,
          userId: true,
          episodeId: true,
          assistantId: true,
          modelHistoryJson: true,
          modelHistoryVersion: true,
        },
      },
    },
  })
  if (!row) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
  if (
    row.status !== 'running' ||
    row.attempt < 1 ||
    row.executionOwnerId !== params.executionOwnerId
  ) {
    throw new Error(`AGENT_TURN_EXECUTION_FENCE_DIVERGED:${row.id}:${row.status}`)
  }
  const context = parseContext(row.contextJson)
  if (
    row.threadId !== row.thread.id ||
    row.projectId !== row.thread.projectId ||
    row.userId !== row.thread.userId ||
    row.episodeId !== row.thread.episodeId ||
    context.episodeId !== row.episodeId ||
    row.thread.assistantId !== 'workspace-command'
  ) {
    throw new Error(`AGENT_TURN_THREAD_SCOPE_DIVERGED:${row.id}`)
  }
  if (
    row.modelHistoryBaseVersion === null ||
    row.modelHistoryBaseVersion !== row.thread.modelHistoryVersion
  ) {
    throw new Error(
      `AGENT_TURN_MODEL_HISTORY_VERSION_DIVERGED:${row.id}:${String(row.modelHistoryBaseVersion)}:${String(row.thread.modelHistoryVersion)}`,
    )
  }
  return {
    turn: toRecord(row),
    context,
    userMessage: await parseStoredUserMessage(row.userMessageJson),
    modelHistory: {
      version: row.thread.modelHistoryVersion,
      items: parseProjectAssistantModelHistory(row.thread.modelHistoryJson),
    },
  }
}

export async function completeAgentTurnExecution(params: {
  turnId: string
  executionOwnerId: string
  assistantMessage: UIMessage
  modelHistoryItems: readonly AgentInputItem[]
  usageFacts: readonly LlmUsageFact[]
  stopReason?: string | null
}): Promise<AgentTurnRecord> {
  if (params.assistantMessage.role !== 'assistant') {
    throw new Error('AGENT_TURN_ASSISTANT_MESSAGE_ROLE_INVALID')
  }
  if (
    !params.assistantMessage.id ||
    params.assistantMessage.id !== params.assistantMessage.id.trim() ||
    params.assistantMessage.id.length > 191
  ) {
    throw new Error('AGENT_TURN_ASSISTANT_MESSAGE_ID_INVALID')
  }
  const owner = params.executionOwnerId.trim()
  if (!owner) throw new Error('AGENT_TURN_EXECUTION_OWNER_REQUIRED')
  const identity = await prisma.projectAgentTurn.findUnique({
    where: { id: params.turnId },
    select: {
      id: true,
      threadId: true,
      projectId: true,
      userId: true,
      episodeId: true,
      modelHistoryBaseVersion: true,
    },
  })
  if (!identity) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
  if (identity.modelHistoryBaseVersion === null) {
    throw new Error(`AGENT_TURN_MODEL_HISTORY_BASE_MISSING:${params.turnId}`)
  }
  const modelHistoryBaseVersion = identity.modelHistoryBaseVersion
  return await prisma.$transaction(
    async (tx) => {
      await commitProjectAssistantTurnInTransaction(tx, {
        threadId: identity.threadId,
        projectId: identity.projectId,
        userId: identity.userId,
        episodeId: identity.episodeId,
        assistantId: 'workspace-command',
        expectedModelHistoryVersion: modelHistoryBaseVersion,
        messages: [params.assistantMessage],
        modelHistoryItems: params.modelHistoryItems,
      })
      const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${params.turnId}
      FOR UPDATE
    `)
      const row = rows[0] ?? null
      if (!row) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
      if (
        row.status !== 'running' ||
        row.attempt < 1 ||
        row.executionOwnerId !== owner ||
        row.threadId !== identity.threadId ||
        row.modelHistoryBaseVersion !== modelHistoryBaseVersion
      ) {
        throw new Error(`AGENT_TURN_COMPLETION_FENCE_DIVERGED:${row.id}:${row.status}`)
      }
      await recordAgentTurnUsageFactsInTransaction({
        tx,
        turnId: row.id,
        attempt: row.attempt,
        projectId: row.projectId,
        userId: row.userId,
        usageFacts: params.usageFacts,
      })
      const updated = await tx.projectAgentTurn.update({
        where: { id: row.id },
        data: {
          status: 'completed',
          assistantMessageId: params.assistantMessage.id,
          stopReason: params.stopReason?.trim() || 'completed',
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
        },
      })
      await clearResolvedApprovalRunStateInTransaction(tx, row.id)
      return toRecord(updated)
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
}

export async function failAgentTurnExecution(params: {
  turnId: string
  executionOwnerId: string
  errorCode: string
  errorMessage: string
  usageFacts?: readonly LlmUsageFact[]
  stopReason?: string | null
}): Promise<AgentTurnRecord> {
  const errorCode = params.errorCode.trim()
  const errorMessage = params.errorMessage.trim()
  if (!errorCode || !errorMessage) {
    throw new Error('AGENT_TURN_FAILURE_ERROR_REQUIRED')
  }
  const identity = await prisma.projectAgentTurn.findUnique({
    where: { id: params.turnId },
    select: { projectId: true, threadId: true },
  })
  if (!identity) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
  return await prisma.$transaction(async (tx) => {
    const { thread, turn: row } = await lockAgentTurnScopeInTransaction({
      tx,
      turnId: params.turnId,
      projectId: identity.projectId,
      threadId: identity.threadId,
    })
    if (
      row.status === 'failed' &&
      row.executionOwnerId === params.executionOwnerId &&
      row.errorCode === errorCode
    ) {
      return toRecord(row)
    }
    if (row.status !== 'running' || row.executionOwnerId !== params.executionOwnerId) {
      throw new Error(`AGENT_TURN_FAILURE_FENCE_DIVERGED:${row.id}:${row.status}`)
    }
    await closeAgentTurnApprovalHistoryInTransaction({
      tx,
      thread,
      turnId: row.id,
      terminalMessage:
        'The approval-resume Turn failed before a complete assistant response. Durable Tool, Task, Provider, Billing, and Resource facts remain authoritative.',
    })
    await recordAgentTurnUsageFactsInTransaction({
      tx,
      turnId: row.id,
      attempt: row.attempt,
      projectId: row.projectId,
      userId: row.userId,
      usageFacts: params.usageFacts ?? [],
    })
    const updated = await tx.projectAgentTurn.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        stopReason: params.stopReason?.trim() || 'execution_failed',
        errorCode,
        errorMessage: errorMessage.slice(0, 2_000),
        finishedAt: new Date(),
      },
    })
    await clearResolvedApprovalRunStateInTransaction(tx, row.id)
    return toRecord(updated)
  })
}

export async function settleAgentTurnAfterActivityLoss(params: {
  turnId: string
  executionOwnerId: string
  errorCode: string
  errorMessage: string
}): Promise<AgentTurnRecord> {
  const errorCode = params.errorCode.trim()
  const errorMessage = params.errorMessage.trim()
  if (!errorCode || !errorMessage) {
    throw new Error('AGENT_TURN_INTERRUPTION_ERROR_REQUIRED')
  }
  const identity = await prisma.projectAgentTurn.findUnique({
    where: { id: params.turnId },
    select: { projectId: true, threadId: true },
  })
  if (!identity) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
  return await prisma.$transaction(async (tx) => {
    const { thread, turn: row } = await lockAgentTurnScopeInTransaction({
      tx,
      turnId: params.turnId,
      projectId: identity.projectId,
      threadId: identity.threadId,
    })
    if (
      row.status === 'completed' ||
      row.status === 'failed' ||
      row.status === 'interrupted' ||
      row.status === 'waiting_approval'
    ) {
      if (row.executionOwnerId !== params.executionOwnerId) {
        throw new Error(`AGENT_TURN_INTERRUPTION_OWNER_DIVERGED:${row.id}:${row.status}`)
      }
      if (row.status !== 'waiting_approval') {
        await clearResolvedApprovalRunStateInTransaction(tx, row.id)
      }
      return toRecord(row)
    }
    if (row.status === 'cancelled') {
      await clearResolvedApprovalRunStateInTransaction(tx, row.id)
      return toRecord(row)
    }
    if (
      row.status !== 'queued' &&
      (row.status !== 'running' || row.executionOwnerId !== params.executionOwnerId)
    ) {
      throw new Error(`AGENT_TURN_INTERRUPTION_FENCE_DIVERGED:${row.id}:${row.status}`)
    }
    await closeAgentTurnApprovalHistoryInTransaction({
      tx,
      thread,
      turnId: row.id,
      terminalMessage:
        'The approval-resume Turn was interrupted before a complete assistant response. Durable Tool, Task, Provider, Billing, and Resource facts remain authoritative.',
    })
    const updated = await tx.projectAgentTurn.update({
      where: { id: row.id },
      data: {
        status: 'interrupted',
        executionOwnerId: params.executionOwnerId,
        stopReason: 'activity_lost',
        errorCode,
        errorMessage: errorMessage.slice(0, 2_000),
        finishedAt: new Date(),
      },
    })
    await clearResolvedApprovalRunStateInTransaction(tx, row.id)
    return toRecord(updated)
  })
}

export async function recoverAgentThreadCoordinatorState(
  threadId: string,
): Promise<AgentThreadRecoveryState> {
  const identity = await prisma.projectAssistantThread.findUnique({
    where: { id: threadId },
    select: { id: true, projectId: true },
  })
  if (!identity) {
    return {
      threadExists: false,
      queuedTurns: [],
      recoveredTurns: [],
      waitingApproval: null,
      resolvedApproval: null,
      pendingChoiceTurnId: null,
    }
  }
  return await prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM projects WHERE id = ${identity.projectId} FOR UPDATE
    `)
    if (projects.length !== 1) {
      throw new Error(`AGENT_THREAD_RECOVERY_PROJECT_NOT_FOUND:${threadId}`)
    }
    const threads = await tx.$queryRaw<
      Array<{
        id: string
        modelHistoryVersion: number
        modelHistoryJson: Prisma.JsonValue
      }>
    >(Prisma.sql`
      SELECT id, modelHistoryVersion, modelHistoryJson
      FROM project_assistant_threads
      WHERE id = ${threadId}
      FOR UPDATE
    `)
    if (threads.length !== 1) {
      throw new Error(`AGENT_THREAD_RECOVERY_THREAD_NOT_FOUND:${threadId}`)
    }
    const thread = threads[0]
    if (!thread) {
      throw new Error(`AGENT_THREAD_RECOVERY_THREAD_NOT_FOUND:${threadId}`)
    }
    const activeRows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE threadId = ${threadId}
        AND status IN ('queued', 'running', 'waiting_approval')
      ORDER BY createdAt ASC, id ASC
      FOR UPDATE
    `)
    const runningIds = activeRows.filter((turn) => turn.status === 'running').map((turn) => turn.id)
    if (runningIds.length > 1) {
      throw new Error(`AGENT_THREAD_RECOVERY_ACTIVE_AMBIGUOUS:${threadId}`)
    }
    if (runningIds.length > 0) {
      const now = new Date()
      const runningId = runningIds[0]
      if (!runningId) {
        throw new Error(`AGENT_THREAD_RECOVERY_ACTIVE_INVALID:${threadId}`)
      }
      await closeAgentTurnApprovalHistoryInTransaction({
        tx,
        thread,
        turnId: runningId,
        terminalMessage:
          'The approval-resume Turn lost its Coordinator before a complete assistant response. Durable Tool, Task, Provider, Billing, and Resource facts remain authoritative.',
      })
      await tx.projectAgentTurn.updateMany({
        where: { id: { in: runningIds }, status: 'running' },
        data: {
          status: 'interrupted',
          stopReason: 'coordinator_execution_lost',
          errorCode: 'AGENT_TURN_COORDINATOR_EXECUTION_LOST',
          errorMessage: 'The prior Coordinator execution ended before settlement.',
          finishedAt: now,
        },
      })
      for (const turnId of runningIds) {
        await clearResolvedApprovalRunStateInTransaction(tx, turnId)
      }
    }
    const currentRows = await tx.projectAgentTurn.findMany({
      where: {
        threadId,
        OR: [{ status: { in: ['queued', 'waiting_approval'] } }, { id: { in: runningIds } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const queuedTurns = currentRows.filter((turn) => turn.status === 'queued')
    const foregroundQueuedTurns = queuedTurns.filter(
      (turn) => turn.sourceKind !== AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP,
    )
    if (foregroundQueuedTurns.length > 1) {
      throw new Error(`AGENT_THREAD_RECOVERY_FOREGROUND_AMBIGUOUS:${threadId}`)
    }
    // Workflow memory gives a user decision/new message priority over older
    // background follow-ups. Reconstruct that same order after execution loss;
    // createdAt alone would let a background Turn advance model history first.
    queuedTurns.sort((left, right) => {
      const leftBackground = left.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
      const rightBackground = right.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
      return Number(leftBackground) - Number(rightBackground)
    })
    const waitingTurns = currentRows.filter((turn) => turn.status === 'waiting_approval')
    if (waitingTurns.length > 1) {
      throw new Error(`AGENT_THREAD_RECOVERY_APPROVAL_AMBIGUOUS:${threadId}`)
    }
    const pendingChoices = await tx.$queryRaw<
      Array<{
        turnId: string
        stopReason: string | null
        turnStatus: string
      }>
    >(Prisma.sql`
      SELECT interaction.turnId,
             turn.stopReason,
             turn.status AS turnStatus
      FROM agent_turn_interactions interaction
      JOIN project_agent_turns turn ON turn.id = interaction.turnId
      WHERE turn.threadId = ${threadId}
        AND interaction.kind = 'choice'
        AND interaction.status = 'pending'
      ORDER BY interaction.createdAt ASC, interaction.id ASC
      FOR UPDATE
    `)
    if (
      pendingChoices.length > 1 ||
      pendingChoices.some(
        (choice) => choice.turnStatus !== 'completed' || choice.stopReason !== 'awaiting_choice',
      )
    ) {
      throw new Error(`AGENT_THREAD_RECOVERY_CHOICE_DIVERGED:${threadId}`)
    }
    const recoveredTurns = currentRows.filter((turn) => runningIds.includes(turn.id))
    const waiting = waitingTurns[0] ?? null
    const currentApproval = waiting
      ? await tx.agentTurnInteraction.findMany({
          where: {
            turnId: waiting.id,
            kind: 'approval',
            runState: { not: null },
            status: { in: ['pending', 'approved', 'rejected'] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            status: true,
            responseJson: true,
          },
        })
      : []
    if (waiting && currentApproval.length !== 1) {
      throw new Error(`AGENT_THREAD_RECOVERY_APPROVAL_STATE_DIVERGED:${threadId}`)
    }
    const approval = currentApproval[0] ?? null
    let resolvedApproval: AgentThreadRecoveryState['resolvedApproval'] = null
    if (approval && approval.status !== 'pending') {
      if (!isRecord(approval.responseJson)) {
        throw new Error(`AGENT_THREAD_RECOVERY_APPROVAL_RESPONSE_INVALID:${approval.id}`)
      }
      const response = approval.responseJson
      const requestId = parseNullableString(
        response.requestId,
        'AGENT_THREAD_RECOVERY_APPROVAL_REQUEST_INVALID',
      )
      const reason = parseNullableString(
        response.reason,
        'AGENT_THREAD_RECOVERY_APPROVAL_REASON_INVALID',
      )
      if (
        !requestId ||
        (response.decision !== 'approve' && response.decision !== 'reject') ||
        response.decision !== (approval.status === 'approved' ? 'approve' : 'reject')
      ) {
        throw new Error(`AGENT_THREAD_RECOVERY_APPROVAL_RESPONSE_DIVERGED:${approval.id}`)
      }
      resolvedApproval = {
        threadId,
        turnId: waiting.id,
        interactionId: approval.id,
        projectId: waiting.projectId,
        userId: waiting.userId,
        episodeId: waiting.episodeId,
        requestId,
        decision: response.decision,
        reason,
      }
    }
    return {
      threadExists: true,
      queuedTurns: queuedTurns.map(toRecord),
      recoveredTurns: recoveredTurns.map(toRecord),
      waitingApproval: waiting
        ? {
            turnId: waiting.id,
            status: 'waiting_approval',
            stopReason: waiting.stopReason,
            errorCode: waiting.errorCode,
          }
        : null,
      resolvedApproval,
      pendingChoiceTurnId: pendingChoices[0]?.turnId ?? null,
    }
  })
}
