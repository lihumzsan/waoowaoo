import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentFollowUpBatchBinding } from '@/lib/operations/types'
import type { AgentTurnContextSnapshot } from './contracts'
import { projectErrorForModel } from '@/lib/errors/projection'

const FOLLOW_UP_BATCH_MAX_MEMBERS = 64
const FOLLOW_UP_INPUT_MAX_BYTES = 512 * 1_024

export interface AgentFollowUpBatchOrigin {
  executionKey: string
  turnId: string
  callId: string
  operationId: string
}

export interface FollowUpBatchNotification {
  batchId: string
  threadId: string
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: 'workspace-command'
  context: AgentTurnContextSnapshot
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

function parseContext(value: unknown): AgentTurnContextSnapshot {
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
    episodeId: nullable('episodeId'),
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
    select: { projectId: true, threadId: true },
  })
  if (!turnIdentity) {
    throw new Error(`FOLLOW_UP_BATCH_TURN_NOT_FOUND:${turnId}`)
  }
  const projects = await params.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM projects
    WHERE id = ${turnIdentity.projectId}
    FOR UPDATE
  `)
  if (projects.length !== 1) {
    throw new Error(
      `FOLLOW_UP_BATCH_PROJECT_NOT_FOUND:${turnIdentity.projectId}`,
    )
  }
  const threads = await params.tx.$queryRaw<
    Array<{
      id: string
      projectId: string
      userId: string
      episodeId: string | null
      assistantId: string
    }>
  >(Prisma.sql`
    SELECT id, projectId, userId, episodeId, assistantId
    FROM project_assistant_threads
    WHERE id = ${turnIdentity.threadId}
    FOR UPDATE
  `)
  const thread = threads[0] ?? null
  const turns = await params.tx.$queryRaw<
    Array<{
      id: string
      threadId: string
      projectId: string
      userId: string
      episodeId: string | null
      status: string
      contextJson: Prisma.JsonValue
    }>
  >(Prisma.sql`
    SELECT id, threadId, projectId, userId, episodeId, status, contextJson
    FROM project_agent_turns
    WHERE id = ${turnId}
    FOR UPDATE
  `)
  const turn = turns[0] ?? null
  if (!turn || turn.status !== 'running') {
    throw new Error(
      `FOLLOW_UP_BATCH_TURN_NOT_RUNNING:${turnId}:${turn?.status ?? 'missing'}`,
    )
  }
  if (
    !thread ||
    thread.id !== turn.threadId ||
    thread.projectId !== turn.projectId ||
    thread.userId !== turn.userId ||
    thread.episodeId !== turn.episodeId ||
    thread.assistantId !== 'workspace-command'
  ) {
    throw new Error(`FOLLOW_UP_BATCH_THREAD_SCOPE_DIVERGED:${turnId}`)
  }
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
      existing.episodeId !== turn.episodeId ||
      existing.status !== 'pending' ||
      existing.members.length !== taskIds.length ||
      existing.members.some((member, index) => member.taskId !== taskIds[index])
    ) {
      throw new Error(`FOLLOW_UP_BATCH_REPLAY_DIVERGED:${executionKey}`)
    }
    return existing.id
  }
  const context = parseContext(turn.contextJson)
  if (context.episodeId !== turn.episodeId) {
    throw new Error(`FOLLOW_UP_BATCH_CONTEXT_SCOPE_DIVERGED:${turnId}`)
  }
  await params.tx.followUpBatch.create({
    data: {
      id: batchId,
      executionKey,
      threadId: turn.threadId,
      originTurnId: turn.id,
      callId,
      projectId: turn.projectId,
      userId: turn.userId,
      episodeId: turn.episodeId,
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

export async function loadFollowUpBatchNotification(
  batchIdValue: string,
): Promise<
  | { kind: 'cancelled' }
  | { kind: 'notified'; turnId: string }
  | { kind: 'ready'; notification: FollowUpBatchNotification }
> {
  const batchId = requireIdentity(batchIdValue, 'FOLLOW_UP_BATCH_ID_INVALID')
  const batch = await prisma.followUpBatch.findUnique({
    where: { id: batchId },
  })
  if (!batch) throw new Error(`FOLLOW_UP_BATCH_NOT_FOUND:${batchId}`)
  if (batch.status === 'cancelled') return { kind: 'cancelled' }
  if (batch.status === 'notified' && batch.notifiedTurnId) {
    return { kind: 'notified', turnId: batch.notifiedTurnId }
  }
  if (batch.status !== 'ready') {
    throw new Error(`FOLLOW_UP_BATCH_NOT_READY:${batchId}:${batch.status}`)
  }
  if (batch.assistantId !== 'workspace-command') {
    throw new Error(`FOLLOW_UP_BATCH_ASSISTANT_INVALID:${batchId}`)
  }
  return {
    kind: 'ready',
    notification: {
      batchId,
      threadId: batch.threadId,
      projectId: batch.projectId,
      userId: batch.userId,
      episodeId: batch.episodeId,
      assistantId: 'workspace-command',
      context: parseContext(batch.contextJson),
    },
  }
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

export async function loadAgentTurnFollowUpInput(params: {
  turnId: string
  batchId: string
}): Promise<AgentInputItem> {
  const [turn, batch] = await Promise.all([
    prisma.projectAgentTurn.findUnique({
      where: { id: params.turnId },
      select: { threadId: true, sourceKind: true, sourceId: true },
    }),
    prisma.followUpBatch.findUnique({
      where: { id: params.batchId },
      include: {
        members: {
          orderBy: { taskId: 'asc' },
          include: {
            task: {
              select: {
                id: true,
                type: true,
                status: true,
                targetType: true,
                targetId: true,
                result: true,
                errorCode: true,
              },
            },
          },
        },
      },
    }),
  ])
  if (
    !turn ||
    !batch ||
    turn.threadId !== batch.threadId ||
    turn.sourceKind !== 'task_follow_up' ||
    turn.sourceId !== batch.id ||
    (batch.status !== 'ready' && batch.status !== 'notified') ||
    batch.members.some((member) => member.status === 'pending')
  ) {
    throw new Error(
      `FOLLOW_UP_BATCH_INPUT_NOT_READY:${params.turnId}:${params.batchId}`,
    )
  }
  const facts = batch.members.map((member) => ({
    taskId: member.task.id,
    taskType: member.task.type,
    status: member.task.status,
    targetType: member.task.targetType,
    targetId: member.task.targetId,
    result: member.task.result,
    failure: member.task.status === 'failed'
      ? projectErrorForModel(member.task.errorCode)
      : null,
  }))
  const content = [
    '[task_follow_up]',
    `batchId=${batch.id}`,
    `originTurnId=${batch.originTurnId}`,
    `toolCallId=${batch.callId}`,
    `operationId=${batch.operationId}`,
    `tasks=${JSON.stringify(facts)}`,
    'A failed task never authorizes automatic resubmission or new billing. Explain the structured failure and wait for explicit user direction.',
    '[/task_follow_up]',
  ].join('\n')
  if (Buffer.byteLength(content, 'utf8') > FOLLOW_UP_INPUT_MAX_BYTES) {
    throw new Error(`FOLLOW_UP_BATCH_MODEL_INPUT_TOO_LARGE:${batch.id}`)
  }
  return {
    role: 'user',
    content,
  } satisfies AgentInputItem
}
