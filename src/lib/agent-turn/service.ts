import { Prisma, type ProjectAgentTurn } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  commitProjectAssistantTurnInTransaction,
  parseProjectAssistantModelHistory,
  validateProjectAssistantThreadMessages,
} from '@/lib/project-agent/persistence'
import {
  AGENT_TURN_SOURCE_KIND,
  type AgentTurnCommandEnvelope,
  type AgentTurnContextSnapshot,
  type AgentTurnExecutionInput,
  type AgentTurnRecord,
  type AgentTurnSourceKind,
  type AgentTurnStatus,
} from './contracts'
import { assertAgentTurnEnvelope, buildAgentTurnId } from './identity'

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
    episodeId: parseNullableString(
      value.episodeId,
      'AGENT_TURN_EPISODE_ID_INVALID',
    ),
    selectedScopeRef: parseNullableString(
      value.selectedScopeRef,
      'AGENT_TURN_SCOPE_REF_INVALID',
    ),
    selectedAssetId: parseNullableString(
      value.selectedAssetId,
      'AGENT_TURN_ASSET_ID_INVALID',
    ),
  }
}

async function parseStoredUserMessage(
  value: unknown,
): Promise<UIMessage | null> {
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
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'waiting_approval' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted' ||
    value === 'cancelled'
  ) {
    return value
  }
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

function assertStoredCommand(
  row: ProjectAgentTurn,
  envelope: AgentTurnCommandEnvelope,
): void {
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
        throw new Error(
          `AGENT_TURN_PROJECT_SCOPE_DIVERGED:${command.projectId}`,
        )
      }
      const locked = await tx.$queryRaw<
        Array<{
          id: string
          projectId: string
          userId: string
          episodeId: string | null
          assistantId: string
          modelHistoryVersion: number
        }>
      >(Prisma.sql`
      SELECT id, projectId, userId, episodeId, assistantId,
             modelHistoryVersion
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
        const batchContext = sourceBatch
          ? parseContext(sourceBatch.contextJson)
          : null
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
          throw new Error(
            `AGENT_TURN_FOLLOW_UP_SOURCE_DIVERGED:${command.sourceId}`,
          )
        }
        if (sourceBatch.status === 'cancelled') {
          return { outcome: 'ignored', reason: 'source_cancelled' }
        }
        if (
          sourceBatch.status !== 'ready' &&
          sourceBatch.status !== 'notified'
        ) {
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
          throw new Error(
            `AGENT_TURN_CHOICE_SOURCE_NOT_READY:${command.sourceId}`,
          )
        }
      }

      const existing = await loadTurnBySource(tx, envelope)
      if (existing) {
        assertStoredCommand(existing, envelope)
        if (
          sourceBatch &&
          (sourceBatch.status !== 'notified' ||
            sourceBatch.notifiedTurnId !== existing.id)
        ) {
          throw new Error(
            `AGENT_TURN_FOLLOW_UP_REPLAY_DIVERGED:${sourceBatch.id}`,
          )
        }
        return { outcome: 'accepted', turn: toRecord(existing) }
      }
      if (command.sourceKind === AGENT_TURN_SOURCE_KIND.USER) {
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
          userMessageJson: command.userMessage
            ? toJson(command.userMessage)
            : Prisma.JsonNull,
          contextJson: toJson(command.context),
          modelHistoryBaseVersion:
            command.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
              ? null
              : thread.modelHistoryVersion,
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
          throw new Error(
            `AGENT_TURN_FOLLOW_UP_NOTIFY_CAS_FAILED:${sourceBatch.id}`,
          )
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
    if (
      row.projectId !== identity.projectId ||
      row.threadId !== identity.threadId
    ) {
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
      throw new Error(
        `AGENT_TURN_CLAIM_REJECTED:${row.id}:${row.status}:${String(row.attempt)}`,
      )
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
    throw new Error(
      `AGENT_TURN_EXECUTION_FENCE_DIVERGED:${row.id}:${row.status}`,
    )
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
  stopReason?: string | null
}): Promise<AgentTurnRecord> {
  if (params.assistantMessage.role !== 'assistant') {
    throw new Error('AGENT_TURN_ASSISTANT_MESSAGE_ROLE_INVALID')
  }
  if (
    !params.assistantMessage.id
    || params.assistantMessage.id !== params.assistantMessage.id.trim()
    || params.assistantMessage.id.length > 191
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
        throw new Error(
          `AGENT_TURN_COMPLETION_FENCE_DIVERGED:${row.id}:${row.status}`,
        )
      }
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
  stopReason?: string | null
}): Promise<AgentTurnRecord> {
  const errorCode = params.errorCode.trim()
  const errorMessage = params.errorMessage.trim()
  if (!errorCode || !errorMessage) {
    throw new Error('AGENT_TURN_FAILURE_ERROR_REQUIRED')
  }
  return await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${params.turnId}
      FOR UPDATE
    `)
    const row = rows[0] ?? null
    if (!row) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
    if (
      row.status === 'failed' &&
      row.executionOwnerId === params.executionOwnerId &&
      row.errorCode === errorCode
    ) {
      return toRecord(row)
    }
    if (
      row.status !== 'running' ||
      row.executionOwnerId !== params.executionOwnerId
    ) {
      throw new Error(
        `AGENT_TURN_FAILURE_FENCE_DIVERGED:${row.id}:${row.status}`,
      )
    }
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
  return await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${params.turnId}
      FOR UPDATE
    `)
    const row = rows[0] ?? null
    if (!row) throw new Error(`AGENT_TURN_NOT_FOUND:${params.turnId}`)
    if (
      row.status === 'interrupted' &&
      row.executionOwnerId === params.executionOwnerId
    ) {
      return toRecord(row)
    }
    if (
      row.status === 'cancelled' &&
      row.executionOwnerId === params.executionOwnerId
    ) {
      return toRecord(row)
    }
    if (
      row.status !== 'running' ||
      row.executionOwnerId !== params.executionOwnerId
    ) {
      throw new Error(
        `AGENT_TURN_INTERRUPTION_FENCE_DIVERGED:${row.id}:${row.status}`,
      )
    }
    const updated = await tx.projectAgentTurn.update({
      where: { id: row.id },
      data: {
        status: 'interrupted',
        stopReason: 'activity_lost',
        errorCode,
        errorMessage: errorMessage.slice(0, 2_000),
        finishedAt: new Date(),
      },
    })
    return toRecord(updated)
  })
}
