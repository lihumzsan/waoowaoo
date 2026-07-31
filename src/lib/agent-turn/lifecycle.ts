import { Prisma, type ProjectAgentTurn } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { AgentTurnExecutionResult } from './contracts'
import { closeAgentTurnApprovalHistoryInTransaction } from './approval-history'

export interface CancelAgentTurnCommand {
  protocol: 'agent_turn_cancel_v1'
  threadId: string
  turnId: string
  projectId: string
  userId: string
  requestId: string
  reason: string | null
}

export interface AgentTurnCancellationReceipt extends AgentTurnExecutionResult {
  protocol: 'agent_turn_cancellation_receipt_v1'
  threadId: string
  projectId: string
  episodeId: string | null
  requestId: string
}

export interface ClearAgentThreadCommand {
  protocol: 'agent_thread_clear_v1'
  threadId: string
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: 'workspace-command'
  requestId: string
}

export interface AgentThreadClearReceipt {
  protocol: 'agent_thread_clear_receipt_v1'
  threadId: string
  projectId: string
  userId: string
  requestId: string
  archivedAt: string
  cancelledTurnIds: readonly string[]
}

function requireIdentity(value: string, code: string, maxLength = 191): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(code)
  }
  return value
}

function validateCancelCommand(command: CancelAgentTurnCommand): void {
  if (command.protocol !== 'agent_turn_cancel_v1') {
    throw new Error('AGENT_TURN_CANCEL_PROTOCOL_INVALID')
  }
  requireIdentity(command.threadId, 'AGENT_TURN_CANCEL_THREAD_ID_INVALID')
  requireIdentity(command.turnId, 'AGENT_TURN_CANCEL_TURN_ID_INVALID')
  requireIdentity(command.projectId, 'AGENT_TURN_CANCEL_PROJECT_ID_INVALID')
  requireIdentity(command.userId, 'AGENT_TURN_CANCEL_USER_ID_INVALID')
  requireIdentity(command.requestId, 'AGENT_TURN_CANCEL_REQUEST_ID_INVALID', 128)
  if (
    command.reason !== null &&
    (!command.reason || command.reason !== command.reason.trim() || command.reason.length > 2_000)
  ) {
    throw new Error('AGENT_TURN_CANCEL_REASON_INVALID')
  }
}

function validateClearCommand(command: ClearAgentThreadCommand): void {
  if (command.protocol !== 'agent_thread_clear_v1') {
    throw new Error('AGENT_THREAD_CLEAR_PROTOCOL_INVALID')
  }
  requireIdentity(command.threadId, 'AGENT_THREAD_CLEAR_THREAD_ID_INVALID')
  requireIdentity(command.projectId, 'AGENT_THREAD_CLEAR_PROJECT_ID_INVALID')
  requireIdentity(command.userId, 'AGENT_THREAD_CLEAR_USER_ID_INVALID')
  requireIdentity(command.requestId, 'AGENT_THREAD_CLEAR_REQUEST_ID_INVALID', 128)
  if (
    command.assistantId !== 'workspace-command' ||
    (command.episodeId !== null &&
      (!command.episodeId || command.episodeId !== command.episodeId.trim()))
  ) {
    throw new Error('AGENT_THREAD_CLEAR_SCOPE_INVALID')
  }
}

function toCancellationReceipt(row: ProjectAgentTurn): AgentTurnCancellationReceipt {
  if (row.status !== 'cancelled' || !row.cancelRequestId) {
    throw new Error(`AGENT_TURN_CANCEL_RECEIPT_INVALID:${row.id}`)
  }
  return {
    protocol: 'agent_turn_cancellation_receipt_v1',
    threadId: row.threadId,
    projectId: row.projectId,
    episodeId: row.episodeId,
    turnId: row.id,
    requestId: row.cancelRequestId,
    status: 'cancelled',
    stopReason: row.stopReason,
    errorCode: row.errorCode,
  }
}

function parseArchivedCancelledTurnIds(value: Prisma.JsonValue | null): string[] {
  if (
    !Array.isArray(value) ||
    value.some((turnId) => typeof turnId !== 'string' || !turnId.trim() || turnId.length > 191) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('AGENT_THREAD_CLEAR_ARCHIVE_RECEIPT_INVALID')
  }
  return value as string[]
}

export async function cancelAgentTurn(
  command: CancelAgentTurnCommand,
): Promise<AgentTurnCancellationReceipt> {
  validateCancelCommand(command)
  const identity = await prisma.projectAgentTurn.findUnique({
    where: { id: command.turnId },
    select: { projectId: true },
  })
  if (!identity) {
    throw new Error(`AGENT_TURN_NOT_FOUND:${command.turnId}`)
  }
  if (identity.projectId !== command.projectId) {
    throw new Error(`AGENT_TURN_CANCEL_SCOPE_DIVERGED:${command.turnId}`)
  }
  return await prisma.$transaction(
    async (tx) => {
      const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${command.projectId}
      FOR UPDATE
    `)
      if (projects.length !== 1) {
        throw new Error(`AGENT_TURN_CANCEL_PROJECT_NOT_FOUND:${command.projectId}`)
      }
      const threads = await tx.$queryRaw<
        Array<{
          id: string
          userId: string
          modelHistoryVersion: number
          modelHistoryJson: Prisma.JsonValue
        }>
      >(Prisma.sql`
      SELECT id, userId, modelHistoryVersion, modelHistoryJson
      FROM project_assistant_threads
      WHERE id = ${command.threadId}
      FOR UPDATE
    `)
      const thread = threads[0] ?? null
      if (!thread || thread.userId !== command.userId) {
        throw new Error(`AGENT_TURN_CANCEL_SCOPE_DIVERGED:${command.turnId}`)
      }
      const turns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${command.turnId}
      FOR UPDATE
    `)
      const turn = turns[0] ?? null
      if (
        !turn ||
        turn.threadId !== command.threadId ||
        turn.projectId !== command.projectId ||
        turn.userId !== command.userId
      ) {
        throw new Error(`AGENT_TURN_CANCEL_SCOPE_DIVERGED:${command.turnId}`)
      }
      if (turn.status === 'cancelled') {
        if (turn.cancelRequestId !== command.requestId || turn.cancelReason !== command.reason) {
          throw new Error(`AGENT_TURN_CANCEL_REPLAY_DIVERGED:${turn.id}`)
        }
        return toCancellationReceipt(turn)
      }
      if (
        turn.status !== 'queued' &&
        turn.status !== 'running' &&
        turn.status !== 'waiting_approval'
      ) {
        throw new Error(`AGENT_TURN_CANCEL_REJECTED:${turn.id}:${turn.status}`)
      }
      await closeAgentTurnApprovalHistoryInTransaction({
        tx,
        thread,
        turnId: turn.id,
        terminalMessage:
          'The user cancelled this Turn while its operation was awaiting or resuming approval. The operation must not be inferred as unperformed if durable effects say otherwise.',
      })
      await tx.agentTurnInteraction.updateMany({
        where: {
          turnId: turn.id,
          status: { in: ['pending', 'approved', 'rejected'] },
        },
        data: {
          status: 'cancelled',
          runState: null,
          version: { increment: 1 },
          resolvedAt: new Date(),
        },
      })
      await tx.followUpBatch.updateMany({
        where: {
          originTurnId: turn.id,
          status: { in: ['pending', 'ready'] },
        },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      })
      const updated = await tx.projectAgentTurn.update({
        where: { id: turn.id },
        data: {
          status: 'cancelled',
          stopReason: 'user_cancelled',
          errorCode: null,
          errorMessage: null,
          cancelRequestId: command.requestId,
          cancelReason: command.reason,
          finishedAt: new Date(),
        },
      })
      return toCancellationReceipt(updated)
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
}

export async function clearAgentThread(
  command: ClearAgentThreadCommand,
): Promise<AgentThreadClearReceipt> {
  validateClearCommand(command)
  return await prisma.$transaction(
    async (tx) => {
      const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${command.projectId}
      FOR UPDATE
    `)
      if (projects.length !== 1) {
        throw new Error(`AGENT_THREAD_CLEAR_PROJECT_NOT_FOUND:${command.projectId}`)
      }
      const threads = await tx.$queryRaw<
        Array<{
          id: string
          projectId: string
          userId: string
          episodeId: string | null
          assistantId: string
          scopeRef: string
          messagesJson: Prisma.JsonValue
          modelHistoryJson: Prisma.JsonValue
          createdAt: Date
          updatedAt: Date
        }>
      >(Prisma.sql`
      SELECT id, projectId, userId, episodeId, assistantId, scopeRef,
             messagesJson, modelHistoryJson, createdAt, updatedAt
      FROM project_assistant_threads
      WHERE id = ${command.threadId}
      FOR UPDATE
    `)
      const thread = threads[0] ?? null
      if (!thread) {
        const archived = await tx.projectAssistantThreadArchive.findUnique({
          where: { threadId: command.threadId },
        })
        if (
          !archived ||
          archived.projectId !== command.projectId ||
          archived.userId !== command.userId ||
          archived.episodeId !== command.episodeId ||
          archived.assistantId !== command.assistantId
        ) {
          throw new Error(`AGENT_THREAD_CLEAR_SCOPE_DIVERGED:${command.threadId}`)
        }
        if (archived.clearRequestId === null || archived.cancelledTurnIds === null) {
          throw new Error(`AGENT_THREAD_CLEAR_REPLAY_UNAVAILABLE:${command.threadId}`)
        }
        if (archived.clearRequestId !== command.requestId) {
          throw new Error(`AGENT_THREAD_CLEAR_REPLAY_DIVERGED:${command.threadId}`)
        }
        return {
          protocol: 'agent_thread_clear_receipt_v1',
          threadId: command.threadId,
          projectId: command.projectId,
          userId: command.userId,
          requestId: archived.clearRequestId,
          archivedAt: archived.archivedAt.toISOString(),
          cancelledTurnIds: parseArchivedCancelledTurnIds(archived.cancelledTurnIds),
        }
      }
      if (
        thread.projectId !== command.projectId ||
        thread.userId !== command.userId ||
        thread.episodeId !== command.episodeId ||
        thread.assistantId !== command.assistantId
      ) {
        throw new Error(`AGENT_THREAD_CLEAR_SCOPE_DIVERGED:${command.threadId}`)
      }
      const cancellableTurns = await tx.projectAgentTurn.findMany({
        where: {
          threadId: thread.id,
          status: { in: ['queued', 'running', 'waiting_approval'] },
        },
        select: { id: true },
      })
      const cancelledTurnIds = cancellableTurns.map((turn) => turn.id)
      await tx.followUpBatch.updateMany({
        where: {
          threadId: thread.id,
          status: { in: ['pending', 'ready', 'notified'] },
        },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      })
      if (cancelledTurnIds.length > 0) {
        await tx.agentTurnInteraction.updateMany({
          where: { turnId: { in: cancelledTurnIds } },
          data: {
            status: 'cancelled',
            runState: null,
            version: { increment: 1 },
            resolvedAt: new Date(),
          },
        })
        await tx.projectAgentTurn.updateMany({
          where: { id: { in: cancelledTurnIds } },
          data: {
            status: 'cancelled',
            stopReason: 'thread_cleared',
            errorCode: null,
            errorMessage: null,
            cancelRequestId: command.requestId,
            cancelReason: 'thread_cleared',
            finishedAt: new Date(),
          },
        })
      }
      const archive = await tx.projectAssistantThreadArchive.create({
        data: {
          threadId: thread.id,
          projectId: thread.projectId,
          userId: thread.userId,
          episodeId: thread.episodeId,
          assistantId: thread.assistantId,
          scopeRef: thread.scopeRef,
          messagesJson: thread.messagesJson as Prisma.InputJsonValue,
          modelHistoryJson: thread.modelHistoryJson as Prisma.InputJsonValue,
          clearRequestId: command.requestId,
          cancelledTurnIds,
          threadCreatedAt: thread.createdAt,
          threadUpdatedAt: thread.updatedAt,
        },
      })
      await tx.projectAssistantThread.delete({ where: { id: thread.id } })
      return {
        protocol: 'agent_thread_clear_receipt_v1',
        threadId: command.threadId,
        projectId: command.projectId,
        userId: command.userId,
        requestId: command.requestId,
        archivedAt: archive.archivedAt.toISOString(),
        cancelledTurnIds,
      }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
}
