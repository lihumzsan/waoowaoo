import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentFollowUpBatchBinding } from '@/lib/operations/types'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { lockAgentTurnEffectFence } from './effect-fence'

const FOLLOW_UP_BATCH_MAX_MEMBERS = OPERATION_EXECUTION_MAX_TASKS

interface FollowUpBatchContext {
  locale: string | null
  selectedScopeRef: string | null
  selectedAssetId: string | null
}

export interface AgentFollowUpBatchOrigin {
  executionKey: string
  turnId: string
  callId: string
  operationId: string
}

function requireIdentity(value: string, code: string, maxLength = 191): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(code)
  }
  return value
}

function buildFollowUpBatchId(executionKey: string): string {
  return `followup_${createHash('sha256')
    .update(executionKey, 'utf8')
    .digest('hex')
    .slice(0, 40)}`
}

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('FOLLOW_UP_BATCH_JSON_INVALID')
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function parseContext(value: unknown): FollowUpBatchContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FOLLOW_UP_BATCH_CONTEXT_INVALID')
  }
  const record = value as Record<string, unknown>
  const nullable = (key: string): string | null => {
    const candidate = record[key]
    if (candidate === null) return null
    if (
      typeof candidate !== 'string' ||
      !candidate ||
      candidate !== candidate.trim()
    ) {
      throw new Error(`FOLLOW_UP_BATCH_CONTEXT_FIELD_INVALID:${key}`)
    }
    return candidate
  }
  return {
    locale: nullable('locale'),
    selectedScopeRef: nullable('selectedScopeRef'),
    selectedAssetId: nullable('selectedAssetId'),
  }
}

async function createFollowUpBatchInTransaction(params: {
  tx: Prisma.TransactionClient
  origin: AgentFollowUpBatchOrigin
  taskIds: readonly string[]
}): Promise<string> {
  const executionKey = requireIdentity(
    params.origin.executionKey,
    'FOLLOW_UP_BATCH_EXECUTION_KEY_INVALID',
  )
  const turnId = requireIdentity(
    params.origin.turnId,
    'FOLLOW_UP_BATCH_TURN_ID_INVALID',
  )
  const callId = requireIdentity(
    params.origin.callId,
    'FOLLOW_UP_BATCH_CALL_ID_INVALID',
  )
  const operationId = requireIdentity(
    params.origin.operationId,
    'FOLLOW_UP_BATCH_OPERATION_ID_INVALID',
    128,
  )
  const taskIds = [
    ...new Set(
      params.taskIds.map((taskId) =>
        requireIdentity(taskId, 'FOLLOW_UP_BATCH_TASK_ID_INVALID'),
      ),
    ),
  ].sort()
  if (
    taskIds.length === 0 ||
    taskIds.length > FOLLOW_UP_BATCH_MAX_MEMBERS ||
    taskIds.length !== params.taskIds.length
  ) {
    throw new Error('FOLLOW_UP_BATCH_MEMBERS_INVALID')
  }
  const turnIdentity = await params.tx.projectAgentTurn.findUnique({
    where: { id: turnId },
    select: { projectId: true, userId: true },
  })
  if (!turnIdentity) {
    throw new Error(`FOLLOW_UP_BATCH_TURN_NOT_FOUND:${turnId}`)
  }
  const turn = await lockAgentTurnEffectFence(params.tx, {
    turnId,
    projectId: turnIdentity.projectId,
    userId: turnIdentity.userId,
  })
  const tasks = await params.tx.$queryRaw<
    Array<{
      id: string
      projectId: string
      userId: string
      status: string
    }>
  >(Prisma.sql`
    SELECT id, projectId, userId, status
    FROM tasks
    WHERE id IN (${Prisma.join(taskIds)})
    ORDER BY id
    FOR UPDATE
  `)
  if (
    tasks.length !== taskIds.length ||
    tasks.some(
      (task, index) =>
        task.id !== taskIds[index] ||
        task.projectId !== turn.projectId ||
        task.userId !== turn.userId,
    )
  ) {
    throw new Error(`FOLLOW_UP_BATCH_TASK_SCOPE_DIVERGED:${executionKey}`)
  }
  if (
    tasks.every(
      (task) => task.status !== 'queued' && task.status !== 'processing',
    )
  ) {
    throw new Error(`FOLLOW_UP_BATCH_WITHOUT_PENDING_TASK:${executionKey}`)
  }
  const batchId = buildFollowUpBatchId(executionKey)
  const existing = await params.tx.followUpBatch.findUnique({
    where: { executionKey },
    include: {
      members: {
        select: { taskId: true },
        orderBy: { taskId: 'asc' },
      },
    },
  })
  if (existing) {
    if (
      existing.id !== batchId ||
      existing.originTurnId !== turnId ||
      existing.callId !== callId ||
      existing.operationId !== operationId ||
      existing.threadId !== turn.threadId ||
      existing.projectId !== turn.projectId ||
      existing.userId !== turn.userId ||
      existing.status !== 'pending' ||
      existing.members.length !== taskIds.length ||
      existing.members.some((member, index) => member.taskId !== taskIds[index])
    ) {
      throw new Error(`FOLLOW_UP_BATCH_REPLAY_DIVERGED:${executionKey}`)
    }
    return existing.id
  }
  const context = parseContext(turn.contextJson)
  await params.tx.followUpBatch.create({
    data: {
      id: batchId,
      executionKey,
      threadId: turn.threadId,
      originTurnId: turn.id,
      callId,
      projectId: turn.projectId,
      userId: turn.userId,
      assistantId: 'workspace-command',
      operationId,
      contextJson: toJson(context),
      status: 'pending',
      members: {
        create: tasks.map((task) => ({
          taskId: task.id,
          status:
            task.status === 'queued' || task.status === 'processing'
              ? 'pending'
              : task.status,
        })),
      },
    },
  })
  return batchId
}

export function createAgentFollowUpBatchBinding(
  origin: AgentFollowUpBatchOrigin,
): ProjectAgentFollowUpBatchBinding {
  let boundTaskIds: readonly string[] | null = null
  return {
    async bindInTransaction(transaction, batch) {
      if (batch.operationId !== origin.operationId || boundTaskIds !== null) {
        throw new Error(
          `FOLLOW_UP_BATCH_BINDING_DIVERGED:${origin.executionKey}`,
        )
      }
      await createFollowUpBatchInTransaction({
        tx: transaction,
        origin,
        taskIds: batch.taskIds,
      })
      boundTaskIds = [...batch.taskIds]
    },
    isBound() {
      return boundTaskIds !== null
    },
  }
}

export async function recordFollowUpBatchTaskTerminalInTransaction(params: {
  tx: Prisma.TransactionClient
  taskId: string
  status: 'completed' | 'failed' | 'canceled'
  terminalEventId: number
}): Promise<string[]> {
  const memberships = await params.tx.$queryRaw<
    Array<{
      batchId: string
      memberStatus: string
      batchStatus: string
      readyByTaskId: string | null
      readyByTerminalEventId: number | null
    }>
  >(Prisma.sql`
    SELECT member.batchId,
           member.status AS memberStatus,
           batch.status AS batchStatus,
           batch.readyByTaskId,
           batch.readyByTerminalEventId
    FROM follow_up_batch_members member
    JOIN follow_up_batches batch ON batch.id = member.batchId
    WHERE member.taskId = ${params.taskId}
    ORDER BY member.batchId
    FOR UPDATE
  `)
  const readyBatchIds: string[] = []
  for (const membership of memberships) {
    if (
      membership.readyByTaskId === params.taskId &&
      membership.readyByTerminalEventId === params.terminalEventId
    ) {
      readyBatchIds.push(membership.batchId)
      continue
    }
    if (membership.memberStatus !== 'pending') {
      const member = await params.tx.followUpBatchMember.findUnique({
        where: {
          batchId_taskId: {
            batchId: membership.batchId,
            taskId: params.taskId,
          },
        },
        select: { status: true, terminalEventId: true },
      })
      if (
        !member ||
        member.status !== params.status ||
        (member.terminalEventId !== null &&
          member.terminalEventId !== params.terminalEventId)
      ) {
        throw new Error(
          `FOLLOW_UP_BATCH_MEMBER_REPLAY_DIVERGED:${membership.batchId}:${params.taskId}`,
        )
      }
      if (member.terminalEventId === null) {
        await params.tx.followUpBatchMember.update({
          where: {
            batchId_taskId: {
              batchId: membership.batchId,
              taskId: params.taskId,
            },
          },
          data: { terminalEventId: params.terminalEventId },
        })
      }
      continue
    }
    await params.tx.followUpBatchMember.update({
      where: {
        batchId_taskId: {
          batchId: membership.batchId,
          taskId: params.taskId,
        },
      },
      data: {
        status: params.status,
        terminalEventId: params.terminalEventId,
        settledAt: new Date(),
      },
    })
    if (membership.batchStatus !== 'pending') continue
    const pendingCount = await params.tx.followUpBatchMember.count({
      where: { batchId: membership.batchId, status: 'pending' },
    })
    if (pendingCount === 0) {
      const changed = await params.tx.followUpBatch.updateMany({
        where: { id: membership.batchId, status: 'pending' },
        data: {
          status: 'ready',
          readyByTaskId: params.taskId,
          readyByTerminalEventId: params.terminalEventId,
          readyAt: new Date(),
        },
      })
      if (changed.count !== 1) {
        throw new Error(
          `FOLLOW_UP_BATCH_READY_CAS_FAILED:${membership.batchId}`,
        )
      }
      readyBatchIds.push(membership.batchId)
    }
  }
  return readyBatchIds
}

export async function loadReadyFollowUpBatchIdsForTerminal(params: {
  taskId: string
  terminalEventId: number
}): Promise<string[]> {
  const batches = await prisma.followUpBatch.findMany({
    where: {
      readyByTaskId: params.taskId,
      readyByTerminalEventId: params.terminalEventId,
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  return batches.map((batch) => batch.id)
}
