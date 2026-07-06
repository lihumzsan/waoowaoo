import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'
import { appendProjectAgentEvents } from './event'

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
  activityId: string | null
  type: ProjectAgentInterruptionType
  status: ProjectAgentInterruptionStatus
  operationId: string
  approvalId: string
  toolCallId: string | null
  payload?: Prisma.JsonValue
  runState: string
}

export interface ProjectAgentChoiceInterruptionRecord {
  id: string
  runId: string | null
  activityId: string | null
  type: 'choice'
  status: ProjectAgentInterruptionStatus
  operationId: string
  toolCallId: string | null
  payload: Prisma.JsonValue
}

export interface ProjectAgentInterruptionSnapshot {
  id: string
  runId: string | null
  activityId: string | null
  type: ProjectAgentInterruptionType
  status: ProjectAgentInterruptionStatus
  operationId: string
  approvalId: string
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

function normalizeInterruptionType(value: string): ProjectAgentInterruptionType {
  if (value === 'approval' || value === 'choice' || value === 'task_wait') return value
  throw new Error(`PROJECT_AGENT_INTERRUPTION_TYPE_INVALID:${value}`)
}

function normalizeInterruptionStatus(value: string): ProjectAgentInterruptionStatus {
  if (value === 'pending' || value === 'consumed' || value === 'superseded') return value
  throw new Error(`PROJECT_AGENT_INTERRUPTION_STATUS_INVALID:${value}`)
}

function toInterruptionSnapshot(record: {
  id: string
  runId: string | null
  activityId: string | null
  type: string
  status: string
  operationId: string
  approvalId: string
  toolCallId: string | null
  payload: Prisma.JsonValue
}): ProjectAgentInterruptionSnapshot {
  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
    type: normalizeInterruptionType(record.type),
    status: normalizeInterruptionStatus(record.status),
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    payload: record.payload,
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
  previousActivityId?: string | null
}): Promise<string> {
  const activityId = randomUUID()
  const interruptionId = randomUUID()
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
  await appendProjectAgentEvents({
    scope: params,
    events: [
      ...(params.previousActivityId
        ? [{
            idempotencyKey: `activity-completed:${params.previousActivityId}:before:${activityId}`,
            event: {
              kind: 'activity.completed' as const,
              runId: params.runId,
              activityId: params.previousActivityId,
            },
          }]
        : []),
      {
        idempotencyKey: `interruption-raised:${interruptionId}`,
        event: {
          kind: 'interruption.raised',
          runId: params.runId,
          activityId,
          interruptionId,
          interruptionKind: 'approval',
          operationId: params.operationId,
          approvalId: params.approvalId,
          toolCallId: params.toolCallId,
          payload: params.payload ?? {},
          runState: params.runState,
        },
      },
    ],
  })
  return interruptionId
}

export async function createProjectAgentChoiceInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  operationId: string
  toolCallId: string | null
  payload: Prisma.InputJsonValue
  previousActivityId?: string | null
}): Promise<string> {
  const activityId = randomUUID()
  const interruptionId = randomUUID()
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
  await appendProjectAgentEvents({
    scope: params,
    events: [
      ...(params.previousActivityId
        ? [{
            idempotencyKey: `activity-completed:${params.previousActivityId}:before:${activityId}`,
            event: {
              kind: 'activity.completed' as const,
              runId: params.runId,
              activityId: params.previousActivityId,
            },
          }]
        : []),
      {
        idempotencyKey: `interruption-raised:${interruptionId}`,
        event: {
          kind: 'interruption.raised',
          runId: params.runId,
          activityId,
          interruptionId,
          interruptionKind: 'choice',
          operationId: params.operationId,
          approvalId: `choice:${randomUUID()}`,
          toolCallId: params.toolCallId,
          choiceType: (() => {
            if (typeof params.payload === 'object' && params.payload && !Array.isArray(params.payload)) {
              const choiceType = (params.payload as Record<string, unknown>).choiceType
              if (
                choiceType === 'bible_review'
                || choiceType === 'style'
                || choiceType === 'asset_review'
                || choiceType === 'budget_confirmation'
              ) return choiceType
            }
            return null
          })(),
          payload: params.payload,
          runState: null,
        },
      },
    ],
  })
  return interruptionId
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

  await appendProjectAgentEvents({
    scope: params,
    events: [{
      idempotencyKey: `interruption-resolved:${record.id}:consumed`,
      event: {
        kind: 'interruption.resolved',
        runId: params.runId,
        activityId: record.activityId,
        interruptionId: record.id,
        outcome: 'consumed',
        response: params.response,
      },
    }],
  })

  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
    type: 'approval',
    status: 'consumed',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    payload: record.payload,
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
      activityId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
      payload: true,
    },
  })
  if (!record) return null
  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
    type: 'approval',
    status: 'pending',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    payload: record.payload,
  }
}

export async function getPendingProjectAgentInterruptionForScope(
  params: ProjectAgentInterruptionScope,
): Promise<ProjectAgentInterruptionSnapshot | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      activityId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
      payload: true,
    },
  })
  return record ? toInterruptionSnapshot(record) : null
}

export async function getLatestProjectAgentInterruptionForRun(params: ProjectAgentInterruptionScope & {
  runId: string
}): Promise<ProjectAgentInterruptionSnapshot | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      activityId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
      payload: true,
    },
  })
  return record ? toInterruptionSnapshot(record) : null
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

  await appendProjectAgentEvents({
    scope: params,
    events: [{
      idempotencyKey: `interruption-resolved:${record.id}:consumed`,
      event: {
        kind: 'interruption.resolved',
        runId: params.runId,
        activityId: record.activityId,
        interruptionId: record.id,
        outcome: 'consumed',
        response: params.response,
      },
    }],
  })

  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
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
    const interruption = await prisma.projectAgentInterruption.findUnique({
      where: {
        id: interruptionId,
      },
      select: {
        id: true,
        runId: true,
        activityId: true,
        projectId: true,
        userId: true,
        episodeId: true,
        assistantId: true,
      },
    })
    if (!interruption?.runId) return
    await appendProjectAgentEvents({
      scope: {
        projectId: interruption.projectId,
        userId: interruption.userId,
        episodeId: interruption.episodeId,
        assistantId: interruption.assistantId as ProjectAssistantId,
      },
      events: [{
        idempotencyKey: `interruption-reopened:${interruption.id}`,
        event: {
          kind: 'interruption.reopened',
          runId: interruption.runId,
          activityId: interruption.activityId,
          interruptionId: interruption.id,
        },
      }],
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
 * Marks every pending interruption in the scope as superseded. Internal
 * replacement path: a newly created interruption displaces any older pending
 * one (a scope has at most one pending interruption). For the user-message
 * path use declinePendingProjectAgentInterruptionsForUserTurn, which records
 * the rejection decision instead. RunState is dropped.
 */
export interface SupersededProjectAgentInterruption {
  id: string
  approvalId: string
  runId: string | null
  activityId: string | null
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
    select: { id: true, approvalId: true, runId: true, activityId: true },
  })
  if (pending.length === 0) return []
  if (pending.some((record) => !record.runId)) {
    throw new Error('PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING')
  }
  await appendProjectAgentEvents({
    scope,
    events: pending.map((record) => ({
        idempotencyKey: `interruption-resolved:${record.id}:superseded`,
        event: {
          kind: 'interruption.resolved' as const,
          runId: record.runId as string,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: 'superseded' as const,
        },
      })),
  })
  return pending
}

export interface DeclinedProjectAgentInterruption {
  id: string
  approvalId: string
  runId: string | null
  activityId: string | null
  type: ProjectAgentInterruptionType
  operationId: string
}

/**
 * Resolves every pending interruption in the scope when the user sends a
 * fresh message instead of answering the card. Unified control semantics:
 * any non-approve response to a pending approval is a rejection. Approvals
 * are therefore consumed with {approved:false, via:'user_message'} so the
 * decision stays an auditable control fact, and the caller projects it into
 * the next run's model input. Choice interruptions carry no reject semantics
 * and are superseded. RunState is dropped in both cases — the old run must
 * never be resumable again.
 */
export async function declinePendingProjectAgentInterruptionsForUserTurn(
  scope: ProjectAgentInterruptionScope,
): Promise<DeclinedProjectAgentInterruption[]> {
  const { assistantId, scopeRef } = buildScope(scope)
  const pending = await prisma.projectAgentInterruption.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'pending',
    },
    select: { id: true, approvalId: true, runId: true, activityId: true, type: true, operationId: true },
  })
  if (pending.length === 0) return []
  if (pending.some((record) => !record.runId)) {
    throw new Error('PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING')
  }

  await appendProjectAgentEvents({
    scope,
    events: pending.map((record) => {
      const isApproval = record.type === 'approval'
      return {
        idempotencyKey: `interruption-resolved:${record.id}:${isApproval ? 'consumed' : 'superseded'}`,
        event: {
          kind: 'interruption.resolved' as const,
          runId: record.runId as string,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: isApproval ? 'consumed' as const : 'superseded' as const,
          ...(isApproval
            ? {
                response: {
                  approved: false,
                  via: 'user_message',
                } satisfies Prisma.InputJsonObject,
              }
            : {}),
        },
      }
    }),
  })
  return pending.map((record) => ({
    id: record.id,
    approvalId: record.approvalId,
    runId: record.runId,
    activityId: record.activityId,
    type: record.type as ProjectAgentInterruptionType,
    operationId: record.operationId,
  }))
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
