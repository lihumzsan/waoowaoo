import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'

export type ProjectAgentInterruptionType = 'approval' | 'choice' | 'task_wait'
export type ProjectAgentInterruptionStatus = 'pending' | 'consumed' | 'superseded'

export interface ProjectAgentInterruptionScope {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

export interface ProjectAgentApprovalInterruptionRecord {
  id: string
  runId: string | null
  type: ProjectAgentInterruptionType
  status: ProjectAgentInterruptionStatus
  operationId: string
  approvalId: string
  toolCallId: string | null
  runState: string
}

export interface ProjectAgentChoiceInterruptionRecord {
  id: string
  runId: string | null
  type: 'choice'
  status: ProjectAgentInterruptionStatus
  operationId: string
  toolCallId: string | null
  payload: Prisma.JsonValue
}

const projectAgentInterruptionLogger = createScopedLogger({
  module: 'project-agent.interruptions',
})

function buildScope(scope: ProjectAgentInterruptionScope): {
  assistantId: ProjectAssistantId
  scopeRef: string
} {
  const assistantId = scope.assistantId ?? 'workspace-command'
  return {
    assistantId,
    scopeRef: buildProjectAssistantScopeRef({
      projectId: scope.projectId,
      episodeId: scope.episodeId ?? null,
    }),
  }
}

/**
 * Registers a pending approval interruption. Any previously pending interruption
 * in the same scope is superseded: a scope has at most one pending interruption.
 * The serialized RunState stays server-side; clients only ever see the id.
 */
export async function createProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  operationId: string
  approvalId: string
  toolCallId: string | null
  runState: string
  payload?: Prisma.InputJsonValue
}): Promise<string> {
  const { assistantId, scopeRef } = buildScope(params)
  const superseded = await supersedePendingProjectAgentInterruptions(params)
  if (superseded.length > 0) {
    projectAgentInterruptionLogger.warn({
      action: 'assistant.interruption.superseded-by-new',
      message: 'Pending project agent interruptions superseded by a new interruption',
      projectId: params.projectId,
      userId: params.userId,
      details: { supersededIds: superseded.map((record) => record.id) },
    })
  }
  const record = await prisma.projectAgentInterruption.create({
    data: {
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      episodeId: params.episodeId ?? null,
      type: 'approval',
      status: 'pending',
      operationId: params.operationId,
      approvalId: params.approvalId,
      toolCallId: params.toolCallId,
      payload: params.payload ?? {},
      runState: params.runState,
    },
    select: { id: true },
  })
  return record.id
}

export async function createProjectAgentChoiceInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  operationId: string
  toolCallId: string | null
  payload: Prisma.InputJsonValue
}): Promise<string> {
  const { assistantId, scopeRef } = buildScope(params)
  const superseded = await supersedePendingProjectAgentInterruptions(params)
  if (superseded.length > 0) {
    projectAgentInterruptionLogger.warn({
      action: 'assistant.choice-interruption.superseded-by-new',
      message: 'Pending project agent interruptions superseded by a new choice interruption',
      projectId: params.projectId,
      userId: params.userId,
      details: { supersededIds: superseded.map((record) => record.id) },
    })
  }
  const record = await prisma.projectAgentInterruption.create({
    data: {
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      episodeId: params.episodeId ?? null,
      type: 'choice',
      status: 'pending',
      operationId: params.operationId,
      approvalId: `choice:${crypto.randomUUID()}`,
      toolCallId: params.toolCallId,
      payload: params.payload,
      runState: null,
    },
    select: { id: true },
  })
  return record.id
}

/**
 * Atomically consumes a pending approval interruption (pending -> consumed).
 * Returns null when the interruption is missing, already consumed, superseded,
 * or out of scope — callers must treat that as a protocol conflict, never guess.
 */
export async function consumeProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  interruptionId: string
  response: Prisma.InputJsonValue
}): Promise<ProjectAgentApprovalInterruptionRecord | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      id: params.interruptionId,
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      type: 'approval',
    },
  })
  if (!record || record.status !== 'pending' || !record.runState) return null

  const consumed = await prisma.projectAgentInterruption.updateMany({
    where: {
      id: record.id,
      status: 'pending',
    },
    data: {
      status: 'consumed',
      response: params.response,
      consumedAt: new Date(),
    },
  })
  if (consumed.count !== 1) return null

  return {
    id: record.id,
    runId: record.runId,
    type: 'approval',
    status: 'consumed',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    runState: record.runState,
  }
}

export async function getPendingProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
}): Promise<Omit<ProjectAgentApprovalInterruptionRecord, 'runState'> | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      type: 'approval',
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
    },
  })
  if (!record) return null
  return {
    id: record.id,
    runId: record.runId,
    type: 'approval',
    status: 'pending',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
  }
}

export async function consumeProjectAgentChoiceInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  interruptionId: string
  response: Prisma.InputJsonValue
}): Promise<ProjectAgentChoiceInterruptionRecord | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      id: params.interruptionId,
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      type: 'choice',
    },
  })
  if (!record || record.status !== 'pending') return null

  const consumed = await prisma.projectAgentInterruption.updateMany({
    where: {
      id: record.id,
      runId: params.runId,
      status: 'pending',
    },
    data: {
      status: 'consumed',
      response: params.response,
      consumedAt: new Date(),
    },
  })
  if (consumed.count !== 1) return null

  return {
    id: record.id,
    runId: record.runId,
    type: 'choice',
    status: 'consumed',
    operationId: record.operationId,
    toolCallId: record.toolCallId,
    payload: record.payload,
  }
}

/**
 * Re-opens an interruption that was consumed but whose continuation run failed
 * to start. Best-effort: keeps the approval answerable instead of dead.
 */
export async function reopenProjectAgentInterruption(interruptionId: string): Promise<void> {
  try {
    await prisma.projectAgentInterruption.updateMany({
      where: {
        id: interruptionId,
        status: 'consumed',
      },
      data: {
        status: 'pending',
        response: Prisma.DbNull,
        consumedAt: null,
      },
    })
  } catch (error) {
    projectAgentInterruptionLogger.error({
      action: 'assistant.interruption.reopen.failed',
      message: 'Failed to reopen project agent interruption',
      details: {
        interruptionId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

/**
 * Marks every pending interruption in the scope as superseded. Called when the
 * user starts a fresh turn instead of answering: the old run is abandoned, so
 * its interruptions must never be resumable again. RunState is dropped.
 */
export interface SupersededProjectAgentInterruption {
  id: string
  approvalId: string
  runId: string | null
}

export async function supersedePendingProjectAgentInterruptions(
  scope: ProjectAgentInterruptionScope,
): Promise<SupersededProjectAgentInterruption[]> {
  const { assistantId, scopeRef } = buildScope(scope)
  const pending = await prisma.projectAgentInterruption.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'pending',
    },
    select: { id: true, approvalId: true, runId: true },
  })
  if (pending.length === 0) return []
  await prisma.projectAgentInterruption.updateMany({
    where: {
      id: { in: pending.map((record) => record.id) },
      status: 'pending',
    },
    data: {
      status: 'superseded',
      runState: null,
      consumedAt: new Date(),
    },
  })
  return pending
}

/**
 * Drops the serialized RunState of a consumed interruption once its
 * continuation run has finished. The row stays for audit; the heavy and
 * security-sensitive state does not.
 */
export async function clearProjectAgentInterruptionRunState(interruptionId: string): Promise<void> {
  try {
    await prisma.projectAgentInterruption.updateMany({
      where: { id: interruptionId },
      data: { runState: null },
    })
  } catch (error) {
    projectAgentInterruptionLogger.error({
      action: 'assistant.interruption.clear-run-state.failed',
      message: 'Failed to clear project agent interruption run state',
      details: {
        interruptionId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
