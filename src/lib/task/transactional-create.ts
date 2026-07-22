import { Prisma, type Task } from '@prisma/client'
import { prepareTaskBillingInTransaction } from '@/lib/billing'
import { createOutboxCommandInTransaction } from '@/lib/outbox/repository'
import { OUTBOX_COMMAND_KIND } from '@/lib/outbox/types'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import { getTaskDefinition } from './definition'
import { buildTaskLifecycleEventPayload } from './publisher'
import { createTaskExecutionFingerprint } from './execution-identity'
import { projectTaskLifecyclePayload } from './result-projection'
import {
  TASK_EVENT_TYPE,
  TASK_STATUS,
  type BillingMode,
  type CreateTaskInput,
  type TaskBillingInfo,
} from './types'

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function assertTaskSubmissionScope(
  tx: Prisma.TransactionClient,
  input: CreateTaskInput & { readonly id?: string },
): Promise<void> {
  const episodeId = input.episodeId || null
  resolveWorkspaceResourceRefs({
    impact: getTaskDefinition(input.type).terminalResourceImpact,
    projectId: input.projectId,
    episodeId,
  })
  if (!episodeId) return
  const episode = await tx.projectEpisode.findUnique({
    where: { id: episodeId },
    select: { projectId: true },
  })
  if (!episode || episode.projectId !== input.projectId) {
    throw new Error(`TASK_EPISODE_SCOPE_MISMATCH:${input.projectId}:${episodeId}`)
  }
}

async function persistValidatedSubmittedTaskInTransaction(params: {
  readonly tx: Prisma.TransactionClient
  readonly input: CreateTaskInput & { readonly id?: string }
  readonly billingMode: BillingMode
  readonly onTaskCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    task: { id: string },
  ) => Promise<void>
}): Promise<Task> {
  const input = params.input
  const task = await params.tx.task.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      userId: input.userId,
      projectId: input.projectId,
      parentTaskId: input.parentTaskId || null,
      episodeId: input.episodeId || null,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      status: TASK_STATUS.QUEUED,
      progress: 0,
      attempt: 0,
      priority: input.priority ?? 0,
      dedupeKey: input.dedupeKey || null,
      batchKey: input.batchKey || null,
      operationId: input.operationId || null,
      operationSource: input.operationSource || null,
      approvalGrantId: input.approvalGrantId ?? null,
      operationExecutionId: input.operationExecutionId ?? null,
      operationPlanTaskId: input.operationPlanTaskId ?? null,
      operationRequestId: input.operationRequestId || null,
      payload: toJson(input.payload),
      executionFingerprint: createTaskExecutionFingerprint(input),
      billingInfo: toJson(input.billingInfo),
      queuedAt: new Date(),
    },
  })
  const preparedBilling = input.billingInfo === null || input.billingInfo === undefined
    ? null
    : await prepareTaskBillingInTransaction(
      params.tx,
      {
        id: task.id,
        userId: task.userId,
        projectId: task.projectId,
        episodeId: task.episodeId,
        billingInfo: input.billingInfo,
      },
      params.billingMode,
    ) as TaskBillingInfo | null
  const stored = await params.tx.task.update({
    where: { id: task.id },
    data: { billingInfo: toJson(preparedBilling) },
  })

  await params.onTaskCreatedInTransaction?.(params.tx, stored)

  const event = await params.tx.taskEvent.create({
    data: {
      taskId: stored.id,
      projectId: stored.projectId,
      userId: stored.userId,
      eventType: TASK_EVENT_TYPE.CREATED,
      idempotencyKey: `task-created:${stored.id}`,
      payload: toJson(buildTaskLifecycleEventPayload({
        taskId: stored.id,
        projectId: stored.projectId,
        lifecycleType: TASK_EVENT_TYPE.CREATED,
        taskType: stored.type,
        targetType: stored.targetType,
        targetId: stored.targetId,
        episodeId: stored.episodeId,
        coveragePayload: input.payload,
        payload: projectTaskLifecyclePayload(input.type, {
          ...(input.payload || {}),
          parentTaskId: input.parentTaskId || null,
          billing: preparedBilling,
          trace: { requestId: input.operationRequestId || null },
        }),
      })),
    },
  })
  await createOutboxCommandInTransaction(params.tx, {
    idempotencyKey: `task-lifecycle-broadcast:${event.id}`,
    aggregateType: 'task',
    aggregateId: stored.id,
    payload: {
      kind: OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST,
      eventId: event.id,
      taskId: stored.id,
    },
  })
  await createOutboxCommandInTransaction(params.tx, {
    idempotencyKey: `task-enqueue:${stored.id}`,
    aggregateType: 'task',
    aggregateId: stored.id,
    payload: {
      kind: OUTBOX_COMMAND_KIND.TASK_ENQUEUE,
      taskId: stored.id,
      operationExecutionId: stored.operationExecutionId,
    },
  })
  return stored
}

export async function persistSubmittedTaskInTransaction(params: {
  readonly tx: Prisma.TransactionClient
  readonly input: CreateTaskInput & { readonly id?: string }
  readonly billingMode: BillingMode
  readonly onTaskCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    task: { id: string },
  ) => Promise<void>
}): Promise<Task> {
  await assertTaskSubmissionScope(params.tx, params.input)
  return await persistValidatedSubmittedTaskInTransaction(params)
}

type PersistedBatchTask = {
  readonly task: Task
  readonly deduped: boolean
}

async function assertExistingSubmissionBundle(
  tx: Prisma.TransactionClient,
  task: Task,
  input: CreateTaskInput & { readonly id?: string },
): Promise<void> {
  const expectedFingerprint = createTaskExecutionFingerprint(input)
  if (task.executionFingerprint !== expectedFingerprint) {
    throw new Error(`TASK_BATCH_IDENTITY_CONFLICT:${task.id}`)
  }
  if (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.PROCESSING) {
    throw new Error(`TASK_BATCH_TERMINAL_DEDUPE_COLLISION:${task.id}:${task.status}`)
  }
  const event = (await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id
    FROM task_events
    WHERE idempotencyKey = ${`task-created:${task.id}`}
    FOR UPDATE
  `))[0] ?? null
  if (!event) throw new Error(`TASK_BATCH_CREATED_EVENT_MISSING:${task.id}`)
  const commandKeys = [
    `task-enqueue:${task.id}`,
    `task-lifecycle-broadcast:${event.id}`,
  ]
  const commands = await tx.$queryRaw<Array<{ idempotencyKey: string }>>(Prisma.sql`
    SELECT idempotencyKey
    FROM outbox_commands
    WHERE idempotencyKey IN (${Prisma.join(commandKeys)})
    FOR UPDATE
  `)
  if (commands.length !== 2) throw new Error(`TASK_BATCH_OUTBOX_BUNDLE_MISSING:${task.id}`)
}

async function loadExistingBatchTask(
  tx: Prisma.TransactionClient,
  input: CreateTaskInput & { readonly id?: string },
): Promise<Task | null> {
  const byId = input.id ? await tx.task.findUnique({ where: { id: input.id } }) : null
  const byDedupe = input.dedupeKey
    ? await tx.task.findUnique({ where: { dedupeKey: input.dedupeKey } })
    : null
  if (byId && byDedupe && byId.id !== byDedupe.id) {
    throw new Error(`TASK_BATCH_IDENTITY_SPLIT:${byId.id}:${byDedupe.id}`)
  }
  return byId ?? byDedupe
}

async function loadCollidedBatchTaskForUpdate(
  tx: Prisma.TransactionClient,
  input: CreateTaskInput & { readonly id?: string },
): Promise<Task | null> {
  const byId = input.id
    ? (await tx.$queryRaw<Task[]>(Prisma.sql`
        SELECT * FROM tasks WHERE id = ${input.id} FOR UPDATE
      `))[0] ?? null
    : null
  const byDedupe = input.dedupeKey
    ? (await tx.$queryRaw<Task[]>(Prisma.sql`
        SELECT * FROM tasks WHERE dedupeKey = ${input.dedupeKey} FOR UPDATE
      `))[0] ?? null
    : null
  if (byId && byDedupe && byId.id !== byDedupe.id) {
    throw new Error(`TASK_BATCH_IDENTITY_SPLIT:${byId.id}:${byDedupe.id}`)
  }
  return byId ?? byDedupe
}

async function lockExistingBatchTaskById(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<Task> {
  const task = (await tx.$queryRaw<Task[]>(Prisma.sql`
    SELECT * FROM tasks WHERE id = ${taskId} FOR UPDATE
  `))[0] ?? null
  if (!task) throw new Error(`TASK_BATCH_EXISTING_TASK_DISAPPEARED:${taskId}`)
  return task
}

export async function persistSubmittedTaskBatchInTransaction(params: {
  readonly tx: Prisma.TransactionClient
  readonly inputs: readonly (CreateTaskInput & { readonly id?: string })[]
  readonly billingMode: BillingMode
  readonly onBatchCreatedInTransaction?: (
    tx: Prisma.TransactionClient,
    orderedTasks: readonly PersistedBatchTask[],
  ) => Promise<void>
}): Promise<readonly PersistedBatchTask[]> {
  if (params.inputs.length === 0) throw new Error('TASK_BATCH_EMPTY')
  const identities = new Set<string>()
  for (const [index, input] of params.inputs.entries()) {
    for (const identity of [
      input.id ? `id:${input.id}` : null,
      input.dedupeKey ? `dedupe:${input.dedupeKey}` : null,
    ]) {
      if (!identity) continue
      if (identities.has(identity)) throw new Error(`TASK_BATCH_DUPLICATE_IDENTITY:${index}:${identity}`)
      identities.add(identity)
    }
  }

  const ordered: PersistedBatchTask[] = []
  for (const input of params.inputs) {
    await assertTaskSubmissionScope(params.tx, input)
    const existingCandidate = await loadExistingBatchTask(params.tx, input)
    if (existingCandidate) {
      const existing = await lockExistingBatchTaskById(params.tx, existingCandidate.id)
      await assertExistingSubmissionBundle(params.tx, existing, input)
      ordered.push({ task: existing, deduped: true })
      continue
    }
    try {
      const task = await persistValidatedSubmittedTaskInTransaction({
        tx: params.tx,
        input,
        billingMode: params.billingMode,
      })
      ordered.push({ task, deduped: false })
    } catch (error) {
      const identityCollision = (input.id || input.dedupeKey)
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      if (!identityCollision) throw error
      const collided = await loadCollidedBatchTaskForUpdate(params.tx, input)
      if (!collided) throw error
      await assertExistingSubmissionBundle(params.tx, collided, input)
      ordered.push({ task: collided, deduped: true })
    }
  }
  await params.onBatchCreatedInTransaction?.(params.tx, ordered)
  return ordered
}
