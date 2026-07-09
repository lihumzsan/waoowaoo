import { prisma } from '@/lib/prisma'
import type { ProjectAgentContext } from './types'
import type { ProjectAgentToolResult } from '@/lib/operations/types'

type UnknownObject = { [key: string]: unknown }
type OperationActivityIdentity = {
  readonly operationId: string | null
  readonly targetKey: string | null
}

const OPERATION_TARGET_ATTEMPT_LIMIT = 2
const CONSECUTIVE_FAILURE_LIMIT = 3
const RUN_WAKEUP_LIMIT = 10

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPayload(value: unknown): UnknownObject | null {
  return isRecord(value) ? value : null
}

export function buildProjectAgentOperationTargetKey(input: {
  operationId: string
  projectId: string
  context: ProjectAgentContext
  toolInput: unknown
}): string {
  const record = isRecord(input.toolInput) ? input.toolInput : {}
  const targetFields = [
    'chapterId',
    'taskId',
    'batchKey',
    'stylePreviewId',
    'requirementId',
    'panelId',
    'storyboardId',
    'assetId',
    'editScriptId',
  ] as const
  for (const field of targetFields) {
    const value = readTrimmedString(record[field])
    if (value) return `${field}:${value}`
  }
  const episodeId = readTrimmedString(input.context.episodeId)
  if (episodeId) return `episodeId:${episodeId}`
  return `projectId:${input.projectId}`
}

export async function enforceProjectAgentOperationRunBudget(input: {
  projectId: string
  userId: string
  runId: string
  operationId: string
  targetKey: string
}): Promise<ProjectAgentToolResult<never> | null> {
  const events = await prisma.projectAgentEvent.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      runId: input.runId,
      kind: { in: ['activity.started', 'activity.completed', 'activity.failed'] },
    },
    orderBy: { id: 'asc' },
    select: {
      kind: true,
      payload: true,
    },
  })

  const unresolvedSameTargetAttempts = new Set<string>()
  let anonymousSameTargetAttempts = 0
  let consecutiveFailures = 0
  const operationActivitiesById = new Map<string, OperationActivityIdentity>()
  for (const event of events) {
    const payload = readPayload(event.payload)
    if (!payload) continue
    if (event.kind === 'activity.started') {
      const activityId = readTrimmedString(payload.activityId)
      const operationId = readTrimmedString(payload.operationId)
      const targetKey = readTrimmedString(payload.targetKey)
      if (payload.type === 'operation' && activityId) {
        operationActivitiesById.set(activityId, {
          operationId,
          targetKey,
        })
      }
      if (operationId === input.operationId && targetKey === input.targetKey) {
        if (activityId) {
          unresolvedSameTargetAttempts.add(activityId)
        } else {
          anonymousSameTargetAttempts += 1
        }
      }
      continue
    }
    const activityId = readTrimmedString(payload.activityId)
    const activity = activityId ? operationActivitiesById.get(activityId) ?? null : null
    if (!activity || activity.operationId !== input.operationId) {
      continue
    }
    if (event.kind === 'activity.completed') {
      if (activityId && activity.targetKey === input.targetKey) {
        unresolvedSameTargetAttempts.delete(activityId)
      }
      consecutiveFailures = 0
      continue
    }
    if (event.kind === 'activity.failed') {
      consecutiveFailures += 1
    }
  }

  const sameTargetAttempts = anonymousSameTargetAttempts + unresolvedSameTargetAttempts.size
  if (sameTargetAttempts >= OPERATION_TARGET_ATTEMPT_LIMIT) {
    return {
      ok: false,
      error: {
        code: 'OPERATION_NOT_ALLOWED',
        message: 'PROJECT_AGENT_OPERATION_TARGET_BUDGET_EXCEEDED',
        operationId: input.operationId,
        details: {
          operationId: input.operationId,
          targetKey: input.targetKey,
          attempts: sameTargetAttempts,
          limit: OPERATION_TARGET_ATTEMPT_LIMIT,
        },
      },
    }
  }

  if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
    return {
      ok: false,
      error: {
        code: 'OPERATION_NOT_ALLOWED',
        message: 'PROJECT_AGENT_CONSECUTIVE_FAILURE_BUDGET_EXCEEDED',
        operationId: input.operationId,
        details: {
          consecutiveFailures,
          limit: CONSECUTIVE_FAILURE_LIMIT,
        },
      },
    }
  }

  return null
}

export async function isProjectAgentRunWakeupBudgetAvailable(input: {
  projectId: string
  userId: string
  runId: string
}): Promise<boolean> {
  const wakeupCount = await prisma.projectAgentEvent.count({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      runId: input.runId,
      kind: 'wait.followed',
    },
  })
  return wakeupCount < RUN_WAKEUP_LIMIT
}

export const PROJECT_AGENT_RUN_WAKEUP_LIMIT = RUN_WAKEUP_LIMIT
