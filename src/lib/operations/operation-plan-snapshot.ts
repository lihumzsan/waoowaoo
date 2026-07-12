import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { BillingQuoteView, OperationPlan, OperationPlanView, PlannedTask } from './planning'
import { canonicalJson, hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'

const PLAN_CONTRACT_VERSION = 1
const DEFAULT_PLAN_TTL_MS = 15 * 60 * 1000

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
  return {
    kind: 'task_submission',
    operationId: readString(record, 'operationId'),
    projectId: readString(record, 'projectId'),
    userId: readString(record, 'userId'),
    tasks: record.tasks.map(parsePlannedTask),
    ...(reservedIdentityIds ? { reservedIdentityIds } : {}),
    ...(summary !== null ? { summary } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

export interface PersistedOperationPlanSnapshot {
  id: string
  contractVersion: number
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
  expiresAt: Date
}

export async function persistOperationPlanSnapshot(params: {
  plan: OperationPlan
  normalizedInput: unknown
  quote: BillingQuoteView
  episodeId?: string | null
  expiresAt?: Date
}): Promise<PersistedOperationPlanSnapshot> {
  const scopeKind = params.plan.projectId === 'global-asset-hub' ? 'global_asset_hub' : 'project'
  const scopeId = params.plan.projectId
  const normalizedInput = toInputJson(params.normalizedInput)
  const planSnapshot = toInputJson(params.plan)
  const quoteSnapshot = toInputJson(params.quote)
  const inputHash = hashCanonicalJson(normalizedInput)
  const planHash = hashCanonicalJson(planSnapshot)
  const quoteHash = hashCanonicalJson(quoteSnapshot)
  const expiresAt = params.expiresAt ?? new Date(Date.now() + DEFAULT_PLAN_TTL_MS)
  const created = await prisma.operationPlanSnapshot.create({
    data: {
      id: randomUUID(),
      contractVersion: PLAN_CONTRACT_VERSION,
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
      expiresAt,
    },
  })
  return {
    id: created.id,
    contractVersion: created.contractVersion,
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
    expiresAt,
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
    contractVersion: record.contractVersion,
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
    expiresAt: record.expiresAt,
  }
}

export function attachPersistedPlanIdentity(view: OperationPlanView, snapshot: PersistedOperationPlanSnapshot): OperationPlanView {
  return {
    ...view,
    planSnapshotId: snapshot.id,
    inputHash: snapshot.inputHash,
    planHash: snapshot.planHash,
    quoteHash: snapshot.quoteHash,
    expiresAt: snapshot.expiresAt.toISOString(),
  }
}
