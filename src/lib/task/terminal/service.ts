import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  rollbackTaskBillingInTransaction,
  settleTaskBillingInTransaction,
} from '@/lib/billing'
import { createOutboxCommandInTransaction } from '@/lib/outbox/repository'
import { OUTBOX_COMMAND_KIND } from '@/lib/outbox/types'
import { resolveProjectAgentWaitsForTaskTerminalInTransaction } from '@/lib/project-agent/waits'
import { projectTaskTargetTerminalInTransaction } from '@/lib/task/target-failure-sync'
import { parseTaskBillingInfo } from '@/lib/task/billing-info'
import {
  parseReadyTaskHandlerCheckpointOutput,
  type ReadyTaskHandlerCheckpointOutput,
} from '@/lib/task/execution-checkpoint'
import { buildTaskLifecycleEventPayload } from '@/lib/task/publisher'
import {
  TASK_EVENT_TYPE,
  TASK_STATUS,
  TASK_TYPE,
  type TaskBillingInfo,
  type TaskType,
} from '@/lib/task/types'
import type { TaskTerminalCommitIntent, TaskTerminalCommitResult } from './types'

const ACTIVE_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] as const
const TASK_TYPES = new Set<string>(Object.values(TASK_TYPE))

type TerminalTaskRow = {
  id: string
  userId: string
  projectId: string
  episodeId: string | null
  type: string
  targetType: string
  targetId: string
  status: string
  attempt: number
  payload: unknown
  billingInfo: unknown
  updatedAt: Date
}

function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.some((value) => value === status)
}

function requireTaskType(value: string): TaskType {
  if (!TASK_TYPES.has(value)) throw new Error(`TASK_TYPE_UNSUPPORTED:${value}`)
  return value as TaskType
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function matchesFence(task: TerminalTaskRow, intent: TaskTerminalCommitIntent): boolean {
  if (!isActiveStatus(task.status)) return true
  if (intent.fence.kind === 'attempt') {
    return task.status === TASK_STATUS.PROCESSING && task.attempt === intent.fence.attempt
  }
  if (intent.fence.kind === 'snapshot') return task.updatedAt.getTime() === intent.fence.updatedAt.getTime()
  return true
}

function lifecycleType(intent: TaskTerminalCommitIntent):
  | typeof TASK_EVENT_TYPE.COMPLETED
  | typeof TASK_EVENT_TYPE.FAILED
  | typeof TASK_EVENT_TYPE.CANCELED {
  if (intent.kind === 'completed') return TASK_EVENT_TYPE.COMPLETED
  if (intent.kind === 'canceled') return TASK_EVENT_TYPE.CANCELED
  return TASK_EVENT_TYPE.FAILED
}

function terminalStatus(intent: TaskTerminalCommitIntent): 'completed' | 'failed' | 'canceled' {
  return intent.kind
}

function terminalEventKey(taskId: string): string {
  return `task-terminal:${taskId}`
}

async function loadLockedTask(tx: Prisma.TransactionClient, taskId: string): Promise<TerminalTaskRow | null> {
  const rows = await tx.$queryRaw<TerminalTaskRow[]>(Prisma.sql`
    SELECT id, userId, projectId, episodeId, type, targetType, targetId,
           status, attempt, payload, billingInfo, updatedAt
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
    select: { id: true },
  })
  if (!event) throw new Error(`TASK_TERMINAL_BUNDLE_MISSING:${task.id}:${task.status}`)
  const commands = await tx.outboxCommand.findMany({
    where: { aggregateType: 'task', aggregateId: task.id },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  return {
    applied: false,
    reason: 'already_terminal',
    existingStatus: task.status,
    terminalEventId: event.id,
    outboxCommandIds: commands.map((command) => command.id),
  }
}

export async function commitTaskTerminal(
  intent: TaskTerminalCommitIntent,
): Promise<TaskTerminalCommitResult> {
  return await prisma.$transaction(async (tx) => {
    const task = await loadLockedTask(tx, intent.taskId)
    if (!task) throw new Error(`TASK_NOT_FOUND:${intent.taskId}`)
    if (!isActiveStatus(task.status)) return await loadExistingTerminalBundle(tx, task)
    if (!matchesFence(task, intent)) {
      return {
        applied: false,
        reason: 'stale_fence',
        existingStatus: task.status,
        terminalEventId: null,
        outboxCommandIds: [],
      }
    }

    const taskType = requireTaskType(task.type)
    const currentBillingInfo = parseTaskBillingInfo(task.billingInfo, taskType)
    let nextBillingInfo = currentBillingInfo
    let errorCode: string | null = null
    let errorMessage: string | null = null
    let completedOutput: ReadyTaskHandlerCheckpointOutput | null = null

    if (intent.kind === 'completed') {
      const checkpoint = await tx.taskExecutionCheckpoint.findUnique({
        where: { id: intent.executionCheckpointId },
        select: { taskId: true, stepKey: true, state: true, output: true },
      })
      if (
        !checkpoint
        || checkpoint.taskId !== task.id
        || checkpoint.stepKey !== '__handler_result__'
        || checkpoint.state !== 'ready'
      ) throw new Error(`TASK_TERMINAL_CHECKPOINT_INVALID:${task.id}`)
      completedOutput = parseReadyTaskHandlerCheckpointOutput(checkpoint.output)
      if (completedOutput.materializedResources.some((resource) => resource.taskId !== task.id)) {
        throw new Error(`TASK_TERMINAL_CHECKPOINT_RESOURCE_TASK_MISMATCH:${task.id}`)
      }
      nextBillingInfo = await settleTaskBillingInTransaction(tx, {
        id: task.id,
        projectId: task.projectId,
        episodeId: task.episodeId,
        userId: task.userId,
        billingInfo: currentBillingInfo,
      }, {
        result: completedOutput.result ?? undefined,
        textUsage: completedOutput.textUsage,
      }) as TaskBillingInfo | null
    } else {
      errorCode = intent.kind === 'failed' ? intent.errorCode : 'TASK_CANCELLED'
      errorMessage = intent.kind === 'failed' ? intent.errorMessage : intent.reason
      nextBillingInfo = await rollbackTaskBillingInTransaction(tx, {
        id: task.id,
        userId: task.userId,
        billingInfo: currentBillingInfo,
      }) as TaskBillingInfo | null
    }

    await projectTaskTargetTerminalInTransaction(tx, {
      kind: intent.kind,
      taskId: task.id,
      type: taskType,
      targetType: task.targetType,
      targetId: task.targetId,
      ...(intent.kind === 'failed'
        ? {
            errorCode,
            errorMessage,
            errorDetails: intent.errorDetails,
          }
        : {}),
    })

    const finishedAt = new Date()
    const status = terminalStatus(intent)
    const updated = await tx.task.updateMany({
      where: { id: task.id, status: { in: [...ACTIVE_STATUSES] } },
      data: {
        status,
        progress: intent.kind === 'completed' ? 100 : undefined,
        result: intent.kind === 'completed' ? toJson(completedOutput?.result) : undefined,
        errorCode,
        errorMessage: errorMessage?.slice(0, 2_000) ?? null,
        billingInfo: toJson(nextBillingInfo),
        billedAt: nextBillingInfo?.billable && nextBillingInfo.status === 'settled' ? finishedAt : null,
        finishedAt,
        heartbeatAt: null,
        dedupeKey: null,
      },
    })
    if (updated.count !== 1) throw new Error(`TASK_TERMINAL_CAS_FAILED:${task.id}`)

    const eventType = lifecycleType(intent)
    const eventPayload = buildTaskLifecycleEventPayload({
      taskId: task.id,
      projectId: task.projectId,
      lifecycleType: eventType,
      taskType,
      targetType: task.targetType,
      targetId: task.targetId,
      episodeId: task.episodeId,
      coveragePayload: task.payload,
      payload: {
        ...toObject(intent.eventPayload),
        ...(completedOutput?.result ?? {}),
        ...(completedOutput?.materializedResources.length
          ? { materializedResources: completedOutput.materializedResources }
          : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(errorMessage ? { message: errorMessage } : {}),
        terminalSource: intent.kind === 'completed' ? 'worker' : intent.source,
      },
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
    const waitCommandIds = await resolveProjectAgentWaitsForTaskTerminalInTransaction(tx, {
      taskId: task.id,
      projectId: task.projectId,
      userId: task.userId,
      lifecycleType: eventType,
    })
    const broadcast = await createOutboxCommandInTransaction(tx, {
      idempotencyKey: `task-lifecycle-broadcast:${event.id}`,
      aggregateType: 'task',
      aggregateId: task.id,
      payload: {
        kind: OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST,
        version: 1,
        eventId: event.id,
        taskId: task.id,
      },
    })
    return {
      applied: true,
      status,
      terminalEventId: event.id,
      outboxCommandIds: [broadcast.id, ...waitCommandIds],
    }
  }, { maxWait: 10_000, timeout: 15_000 })
}
