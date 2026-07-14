import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  assertOperationPlanTaskResourceScopes,
  type BillingQuoteView,
  type OperationPlan,
  type OperationPlanView,
  type PlannedTask,
  type PlannedTaskDependency,
} from './planning'
import { canonicalJson, hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { isTaskType } from '@/lib/task/types'

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:${key}`)
  }
  return value
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:${key}`)
  return value
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:${field}`)
  }
  return value as Record<string, unknown>
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:${field}`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:${field}.${String(index)}`)
    }
    return item
  })
}

function readOptionalArray<T>(
  value: unknown,
  field: string,
  parseItem: (item: unknown) => T,
): T[] | undefined {
  if (value === null || value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:${field}`)
  return value.map(parseItem)
}

function parsePlannedTask(value: unknown): PlannedTask {
  const record = readRecord(value, 'tasks[]')
  const target = readRecord(record.target, 'tasks[].target')
  const payload = readRecord(record.payload, 'tasks[].payload')
  const billingInfo = readRecord(record.billingInfo, 'tasks[].billingInfo') as PlannedTask['billingInfo']
  const locale = readString(record, 'locale') as PlannedTask['locale']
  const priority = record.priority
  if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority))) {
    throw new Error('OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:tasks[].priority')
  }
  return {
    id: readString(record, 'id'),
    taskType: readString(record, 'taskType') as PlannedTask['taskType'],
    target: {
      targetType: readString(target, 'targetType'),
      targetId: readString(target, 'targetId'),
    },
    payload,
    billingInfo,
    locale,
    episodeId: readNullableString(record, 'episodeId'),
    dedupeKey: readNullableString(record, 'dedupeKey'),
    ...(typeof priority === 'number' ? { priority } : {}),
  }
}

function parsePlannedTaskDependency(value: unknown): PlannedTaskDependency {
  const record = readRecord(value, 'taskDependencies[]')
  const target = readRecord(record.target, 'taskDependencies[].target')
  const taskType = readString(record, 'taskType')
  if (!isTaskType(taskType)) {
    throw new Error(`OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:taskDependencies[].taskType:${taskType}`)
  }
  return {
    taskId: readString(record, 'taskId'),
    taskType,
    target: {
      targetType: readString(target, 'targetType'),
      targetId: readString(target, 'targetId'),
    },
    episodeId: readNullableString(record, 'episodeId'),
  }
}

function parseOperationPlan(value: unknown): OperationPlan {
  const record = readRecord(value, 'planSnapshot')
  if (record.kind !== 'task_submission') {
    throw new Error('OPERATION_PLAN_SNAPSHOT_KIND_INVALID')
  }
  if (!Array.isArray(record.tasks)) {
    throw new Error('OPERATION_PLAN_SNAPSHOT_FIELD_INVALID:tasks')
  }
  const summary = readNullableString(record, 'summary')
  const metadata = record.metadata === null || record.metadata === undefined ? undefined : readRecord(record.metadata, 'metadata')
  const reservedIdentityIds = record.reservedIdentityIds === null || record.reservedIdentityIds === undefined
    ? undefined
    : readStringArray(record.reservedIdentityIds, 'reservedIdentityIds')
  const taskDependencies = readOptionalArray(
    record.taskDependencies,
    'taskDependencies',
    parsePlannedTaskDependency,
  )
  return {
    kind: 'task_submission',
    operationId: readString(record, 'operationId'),
    projectId: readString(record, 'projectId'),
    userId: readString(record, 'userId'),
    tasks: record.tasks.map(parsePlannedTask),
    ...(taskDependencies ? { taskDependencies } : {}),
    ...(reservedIdentityIds ? { reservedIdentityIds } : {}),
    ...(summary !== null ? { summary } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

async function assertOperationPlanTaskDependencies(plan: OperationPlan): Promise<void> {
  const dependencies = plan.taskDependencies ?? []
  if (dependencies.length === 0) return
  const dependencyIds = dependencies.map((dependency) => dependency.taskId)
  if (new Set(dependencyIds).size !== dependencyIds.length) {
    throw new Error(`OPERATION_PLAN_TASK_DEPENDENCY_DUPLICATE:${plan.operationId}`)
  }
  const tasks = await prisma.task.findMany({
    where: { id: { in: dependencyIds } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      status: true,
    },
  })
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  for (const dependency of dependencies) {
    const task = taskById.get(dependency.taskId)
    if (!task) throw new Error(`OPERATION_PLAN_TASK_DEPENDENCY_NOT_FOUND:${dependency.taskId}`)
    if (
      task.userId !== plan.userId
      || task.projectId !== plan.projectId
      || task.episodeId !== dependency.episodeId
      || task.type !== dependency.taskType
      || task.targetType !== dependency.target.targetType
      || task.targetId !== dependency.target.targetId
    ) {
      throw new Error(`OPERATION_PLAN_TASK_DEPENDENCY_SCOPE_MISMATCH:${dependency.taskId}`)
    }
    if (task.status !== 'queued' && task.status !== 'processing') {
      throw new Error(`OPERATION_PLAN_TASK_DEPENDENCY_NOT_ACTIVE:${dependency.taskId}:${task.status}`)
    }
  }
}

export interface PersistedOperationPlanSnapshot {
  id: string
  userId: string
  scopeKind: string
  scopeId: string
  projectId: string | null
  episodeId: string | null
  operationId: string
  normalizedInput: unknown
  inputHash: string
  plan: OperationPlan
  planHash: string
  quote: BillingQuoteView
  quoteHash: string
}

export interface OperationPlanArtifactHashes {
  readonly inputHash: string
  readonly planHash: string
  readonly quoteHash: string
}

export function hashOperationPlanArtifacts(params: {
  readonly normalizedInput: unknown
  readonly plan: OperationPlan
  readonly quote: BillingQuoteView
}): OperationPlanArtifactHashes {
  return {
    inputHash: hashCanonicalJson(params.normalizedInput),
    planHash: hashCanonicalJson(params.plan),
    quoteHash: hashCanonicalJson(params.quote),
  }
}

export async function persistOperationPlanSnapshot(params: {
  plan: OperationPlan
  normalizedInput: unknown
  quote: BillingQuoteView
  episodeId?: string | null
}): Promise<PersistedOperationPlanSnapshot> {
  assertOperationPlanTaskResourceScopes(params.plan)
  await assertOperationPlanTaskDependencies(params.plan)
  const scopeKind = params.plan.projectId === 'global-asset-hub' ? 'global_asset_hub' : 'project'
  const scopeId = params.plan.projectId
  const normalizedInput = toInputJson(params.normalizedInput)
  const planSnapshot = toInputJson(params.plan)
  const quoteSnapshot = toInputJson(params.quote)
  const { inputHash, planHash, quoteHash } = hashOperationPlanArtifacts({
    normalizedInput,
    plan: params.plan,
    quote: params.quote,
  })
  const created = await prisma.operationPlanSnapshot.create({
    data: {
      id: randomUUID(),
      userId: params.plan.userId,
      scopeKind,
      scopeId,
      projectId: scopeKind === 'project' ? params.plan.projectId : null,
      episodeId: params.episodeId ?? null,
      operationId: params.plan.operationId,
      normalizedInput,
      inputHash,
      planSnapshot,
      planHash,
      quoteSnapshot,
      quoteHash,
    },
  })
  return {
    id: created.id,
    userId: created.userId,
    scopeKind: created.scopeKind,
    scopeId: created.scopeId,
    projectId: created.projectId,
    episodeId: created.episodeId,
    operationId: created.operationId,
    normalizedInput,
    inputHash,
    plan: params.plan,
    planHash,
    quote: params.quote,
    quoteHash,
  }
}

type OperationPlanSnapshotReader = Pick<Prisma.TransactionClient, 'operationPlanSnapshot'>

export async function loadOperationPlanSnapshot(
  id: string,
  client: OperationPlanSnapshotReader = prisma,
): Promise<PersistedOperationPlanSnapshot | null> {
  const record = await client.operationPlanSnapshot.findUnique({
    where: { id },
  })
  if (!record) return null
  const plan = parseOperationPlan(record.planSnapshot)
  const quote = readRecord(record.quoteSnapshot, 'quoteSnapshot') as unknown as BillingQuoteView
  if (hashCanonicalJson(record.normalizedInput) !== record.inputHash) {
    throw new Error(`OPERATION_PLAN_INPUT_HASH_MISMATCH:${record.id}`)
  }
  if (hashCanonicalJson(record.planSnapshot) !== record.planHash) {
    throw new Error(`OPERATION_PLAN_HASH_MISMATCH:${record.id}`)
  }
  if (hashCanonicalJson(record.quoteSnapshot) !== record.quoteHash) {
    throw new Error(`OPERATION_QUOTE_HASH_MISMATCH:${record.id}`)
  }
  return {
    id: record.id,
    userId: record.userId,
    scopeKind: record.scopeKind,
    scopeId: record.scopeId,
    projectId: record.projectId,
    episodeId: record.episodeId,
    operationId: record.operationId,
    normalizedInput: record.normalizedInput,
    inputHash: record.inputHash,
    plan,
    planHash: record.planHash,
    quote,
    quoteHash: record.quoteHash,
  }
}

export function attachPersistedPlanIdentity(view: OperationPlanView, snapshot: PersistedOperationPlanSnapshot): OperationPlanView {
  return {
    ...view,
    planSnapshotId: snapshot.id,
    inputHash: snapshot.inputHash,
    planHash: snapshot.planHash,
    quoteHash: snapshot.quoteHash,
  }
}
