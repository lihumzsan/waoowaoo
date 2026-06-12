import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'

export type ProjectAgentInterruptionType = 'approval'
export type ProjectAgentInterruptionStatus = 'pending' | 'consumed' | 'superseded'

export interface ProjectAgentInterruptionScope {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

export interface ProjectAgentApprovalInterruptionRecord {
  id: string
  type: ProjectAgentInterruptionType
  status: ProjectAgentInterruptionStatus
  operationId: string
  approvalId: string
  toolCallId: string | null
  runState: string
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

/**
 * Atomically consumes a pending approval interruption (pending -> consumed).
 * Returns null when the interruption is missing, already consumed, superseded,
 * or out of scope — callers must treat that as a protocol conflict, never guess.
 */
export async function consumeProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  interruptionId: string
  response: Prisma.InputJsonValue
}): Promise<ProjectAgentApprovalInterruptionRecord | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      id: params.interruptionId,
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
    type: 'approval',
    status: 'consumed',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    runState: record.runState,
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
    select: { id: true, approvalId: true },
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
