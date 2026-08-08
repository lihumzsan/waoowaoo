import { Prisma } from '@prisma/client'
import type { FailureRecord } from '@/lib/errors/failure'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import {
  rollbackTaskBillingInTransaction,
  settleTaskBillingInTransaction,
} from '@/lib/billing'
import { projectTaskTargetTerminalInTransaction } from '@/lib/task/target-failure-sync'
import { parseTaskBillingInfo } from '@/lib/task/billing-info'
import {
  parseTaskHandlerCheckpointOutput,
  type TaskHandlerCheckpointOutput,
} from '@/lib/task/execution-checkpoint'
import { buildTaskLifecycleEventPayload } from '@/lib/task/publisher'
import { getTaskDefinition } from '@/lib/task/definition'
import { projectTaskLifecyclePayload } from '@/lib/task/result-projection'
import {
  isTaskType,
  TASK_EVENT_TYPE,
  TASK_STATUS,
  type TaskBillingInfo,
  type TaskType,
} from '@/lib/task/types'
import {
  dedupeWorkspaceResourceRefs,
  resolveWorkspaceResourceRefs,
} from '@/lib/workspace-resource/resource-impact'
import type {
  TaskTerminalCommitIntent,
  TaskTerminalCommitResult,
} from './types'
import { materializeWorkspaceResourceTaskTerminalInTransaction } from '@/lib/workspace-resource/task-materializer'
import { recordFollowUpBatchTaskTerminalInTransaction } from '@/lib/agent-turn/follow-up-batch'

const terminalLogger = createScopedLogger({ module: 'task.terminal' })

const ACTIVE_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] as const
type TerminalTaskRow = {
  id: string
  userId: string
  projectId: string
  type: string
  targetType: string
  targetId: string
  status: string
  attempt: number
  payload: unknown
  billingInfo: unknown
  operationId: string | null
  operationExecutionId: string | null
  updatedAt: Date
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.some((value) => value === status)
}

function requireTaskType(value: string): TaskType {
  if (!isTaskType(value)) throw new Error(`TASK_TYPE_UNSUPPORTED:${value}`)
  return value
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function matchesFence(
  task: TerminalTaskRow,
  intent: TaskTerminalCommitIntent,
): boolean {
  if (!isActiveStatus(task.status)) return true
  if (intent.fence.kind === 'attempt') {
    return (
      task.status === TASK_STATUS.PROCESSING &&
      task.attempt === intent.fence.attempt
    )
  }
  if (intent.fence.kind === 'snapshot')
    return task.updatedAt.getTime() === intent.fence.updatedAt.getTime()
  return true
}

function lifecycleType(
  intent: TaskTerminalCommitIntent,
):
  | typeof TASK_EVENT_TYPE.COMPLETED
  | typeof TASK_EVENT_TYPE.FAILED
  | typeof TASK_EVENT_TYPE.CANCELED {
  if (intent.kind === 'completed') return TASK_EVENT_TYPE.COMPLETED
  if (intent.kind === 'canceled') return TASK_EVENT_TYPE.CANCELED
  return TASK_EVENT_TYPE.FAILED
}

function terminalStatus(
  intent: TaskTerminalCommitIntent,
): 'completed' | 'failed' | 'canceled' {
  return intent.kind
}

function terminalEventKey(taskId: string): string {
  return `task-terminal:${taskId}`
}

async function loadLockedTask(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<TerminalTaskRow | null> {
  const rows = await tx.$queryRaw<TerminalTaskRow[]>(Prisma.sql`
    SELECT id, userId, projectId, type, targetType, targetId,
           status, attempt, payload, billingInfo, operationId, operationExecutionId, updatedAt
    FROM tasks
    WHERE id = ${taskId}
    FOR UPDATE
  `)
  return rows[0] ?? null
}

async function loadExistingTerminalBundle(
  tx: Prisma.TransactionClient,
  task: TerminalTaskRow,
): Promise<TaskTerminalCommitResult> {
  const event = await tx.taskEvent.findUnique({
    where: { idempotencyKey: terminalEventKey(task.id) },
    select: { id: true, eventType: true },
  })
  const expectedEventType =
    task.status === TASK_STATUS.COMPLETED
      ? TASK_EVENT_TYPE.COMPLETED
      : task.status === TASK_STATUS.CANCELED
        ? TASK_EVENT_TYPE.CANCELED
        : task.status === TASK_STATUS.FAILED ||
            task.status === TASK_STATUS.DISMISSED
          ? TASK_EVENT_TYPE.FAILED
          : null
  if (!event || event.eventType !== expectedEventType) {
    throw new Error(`TASK_TERMINAL_BUNDLE_MISSING:${task.id}:${task.status}`)
  }
  const readyFollowUpBatchIds =
    await recordFollowUpBatchTaskTerminalInTransaction({
      tx,
      taskId: task.id,
      status:
        task.status === TASK_STATUS.COMPLETED
          ? 'completed'
          : task.status === TASK_STATUS.CANCELED
            ? 'canceled'
            : 'failed',
      terminalEventId: event.id,
    })
  return {
    applied: false,
    reason: 'already_terminal',
    existingStatus: task.status,
    terminalEventId: event.id,
    readyFollowUpBatchIds,
  }
}

export async function commitTaskTerminal(
  intent: TaskTerminalCommitIntent,
): Promise<TaskTerminalCommitResult> {
  const result = await prisma.$transaction(
    async (tx): Promise<TaskTerminalCommitResult> => {
      const task = await loadLockedTask(tx, intent.taskId)
      if (!task) throw new Error(`TASK_NOT_FOUND:${intent.taskId}`)
      if (!isActiveStatus(task.status))
        return await loadExistingTerminalBundle(tx, task)
      if (!matchesFence(task, intent)) {
        return {
          applied: false,
          reason: 'stale_fence',
          existingStatus: task.status,
          terminalEventId: null,
          readyFollowUpBatchIds: [],
        }
      }

      const taskType = requireTaskType(task.type)
      const currentBillingInfo = parseTaskBillingInfo(
        task.billingInfo,
        taskType,
      )
      let nextBillingInfo = currentBillingInfo
      let failure: FailureRecord | null = null
      let completedOutput: TaskHandlerCheckpointOutput | null = null
      let materializedOutput: Record<string, unknown> | null = null

      if (intent.kind === 'completed') {
        const checkpoint = await tx.taskExecutionCheckpoint.findUnique({
          where: { id: intent.executionCheckpointId },
          select: { taskId: true, stepKey: true, state: true, output: true },
        })
        if (
          !checkpoint ||
          checkpoint.taskId !== task.id ||
          checkpoint.stepKey !== '__handler_result__' ||
          checkpoint.state !== 'ready'
        )
          throw new Error(`TASK_TERMINAL_CHECKPOINT_INVALID:${task.id}`)
        completedOutput = parseTaskHandlerCheckpointOutput(checkpoint.output)
        nextBillingInfo = (await settleTaskBillingInTransaction(
          tx,
          {
            id: task.id,
            projectId: task.projectId,
            userId: task.userId,
            billingInfo: currentBillingInfo,
          },
          {
            result: completedOutput.result ?? undefined,
            textUsage: completedOutput.textUsage,
          },
        )) as TaskBillingInfo | null
        materializedOutput =
          await materializeWorkspaceResourceTaskTerminalInTransaction(tx, {
            kind: 'completed',
            task: {
              id: task.id,
              userId: task.userId,
              projectId: task.projectId,
              type: taskType,
              targetType: task.targetType,
              targetId: task.targetId,
              payload: task.payload,
              operationId: task.operationId,
              operationExecutionId: task.operationExecutionId,
            },
            result: completedOutput.result,
          })
        if (materializedOutput) {
          completedOutput = {
            ...completedOutput,
            result: {
              ...(completedOutput.result ?? {}),
              ...materializedOutput,
            },
          }
        }
        await projectTaskTargetTerminalInTransaction(tx, {
          kind: intent.kind,
          taskId: task.id,
          type: taskType,
          targetType: task.targetType,
          targetId: task.targetId,
        })
      } else {
        failure = intent.kind === 'failed' ? intent.failure : null
        materializedOutput =
          await materializeWorkspaceResourceTaskTerminalInTransaction(tx, {
            kind: intent.kind,
            task: {
              id: task.id,
              userId: task.userId,
              projectId: task.projectId,
              type: taskType,
              targetType: task.targetType,
              targetId: task.targetId,
              payload: task.payload,
              operationId: task.operationId,
              operationExecutionId: task.operationExecutionId,
            },
            result: null,
          })
        const targetProjection = await projectTaskTargetTerminalInTransaction(
          tx,
          {
            kind: intent.kind,
            taskId: task.id,
            type: taskType,
            targetType: task.targetType,
            targetId: task.targetId,
          },
        )
        if (targetProjection === 'success_materialized') {
          return {
            applied: false,
            reason: 'completion_pending',
            existingStatus: task.status,
            terminalEventId: null,
            readyFollowUpBatchIds: [],
          }
        }
        nextBillingInfo = (await rollbackTaskBillingInTransaction(tx, {
          id: task.id,
          userId: task.userId,
          billingInfo: currentBillingInfo,
        })) as TaskBillingInfo | null
      }

      const finishedAt = new Date()
      const status = terminalStatus(intent)
      const updated = await tx.task.updateMany({
        where: { id: task.id, status: { in: [...ACTIVE_STATUSES] } },
        data: {
          status,
          progress: intent.kind === 'completed' ? 100 : undefined,
          result:
            intent.kind === 'completed'
              ? toJson(completedOutput?.result)
              : undefined,
          failure: failure ? toJson(failure) : Prisma.DbNull,
          billingInfo: toJson(nextBillingInfo),
          billedAt:
            nextBillingInfo?.billable && nextBillingInfo.status === 'settled'
              ? finishedAt
              : null,
          finishedAt,
          dedupeKey: null,
        },
      })
      if (updated.count !== 1)
        throw new Error(`TASK_TERMINAL_CAS_FAILED:${task.id}`)

      const eventType = lifecycleType(intent)
      const affectedResources = dedupeWorkspaceResourceRefs([
        ...resolveWorkspaceResourceRefs({
          impact: getTaskDefinition(taskType).terminalResourceImpact,
          projectId: task.projectId,
        }),
        ...(materializedOutput
          ? [
              {
                kind: 'workspaceResources',
                projectId: task.projectId,
              } as const,
            ]
          : []),
      ])
      const eventPayload = buildTaskLifecycleEventPayload({
        taskId: task.id,
        projectId: task.projectId,
        lifecycleType: eventType,
        taskType,
        targetType: task.targetType,
        targetId: task.targetId,
        coveragePayload: task.payload,
        affectedResources,
        payload: projectTaskLifecyclePayload(taskType, {
          ...toObject(task.payload),
          ...toObject(intent.eventPayload),
          ...(completedOutput?.result ?? {}),
          ...(materializedOutput ?? {}),
          billing: nextBillingInfo,
          ...(failure ? { errorCode: failure.interpretation.code } : {}),
          terminalSource:
            intent.kind === 'completed' ? 'worker' : intent.source,
        }),
      })
      const event = await tx.taskEvent.create({
        data: {
          taskId: task.id,
          projectId: task.projectId,
          userId: task.userId,
          eventType,
          idempotencyKey: terminalEventKey(task.id),
          payload: toJson(eventPayload),
        },
      })
      const readyFollowUpBatchIds =
        await recordFollowUpBatchTaskTerminalInTransaction({
          tx,
          taskId: task.id,
          status,
          terminalEventId: event.id,
        })
      return {
        applied: true,
        status,
        terminalEventId: event.id,
        readyFollowUpBatchIds,
      }
    },
    { maxWait: 10_000, timeout: 15_000 },
  )
  terminalLogger.info({
    action: 'task.terminal.committed',
    message: 'task terminal commit resolved',
    taskId: intent.taskId,
    details: {
      kind: intent.kind,
      applied: result.applied,
      reason: result.applied ? 'applied' : result.reason,
      fence: intent.fence.kind,
      fenceAttempt:
        intent.fence.kind === 'attempt' ? intent.fence.attempt : null,
    },
  })
  return result
}
